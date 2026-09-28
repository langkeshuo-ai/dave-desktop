import {
  ProviderConfigService,
  type ProviderConfigLayerSnapshot,
  type ProviderConfigLayerUpdate,
} from "@dave/provider";
import { NodeDaveBuiltinProviderConfigSource } from "./dave-builtin-provider-config-source.js";
import {
  EndpointScopedDaveBuiltinSource,
  type EndpointScopedDaveBuiltinSourceOptions,
} from "./endpoint-scoped-dave-builtin-source.js";
import {
  DaveBuiltinRemoteSynchronizer,
  type DaveBuiltinRemoteSynchronizerOptions,
  type DaveBuiltinRefreshResult,
} from "./dave-builtin-remote-synchronizer.js";
import {
  NodePersonalProviderConfigRepository,
  type PersonalProviderConfigRecoveryEvent,
} from "./personal-provider-config-repository.js";

export interface NodeProviderConfigRuntimeOptions {
  readonly daveBuiltinFilePath: string;
  readonly daveBuiltinActiveFilePath?: string;
  readonly daveBuiltinRemote?: Omit<DaveBuiltinRemoteSynchronizerOptions, "source">;
  readonly daveBuiltinEnvironment?: Omit<
    EndpointScopedDaveBuiltinSourceOptions,
    "bundledFilePath"
  >;
  readonly onDaveBuiltinRefreshError?: (error: unknown) => void;
  readonly onPersonalConfigRecovery?: (event: PersonalProviderConfigRecoveryEvent) => void;
  readonly onPersonalConfigPollingError?: (error: unknown) => void;
  readonly personalFilePath: string;
  readonly personalPollingIntervalMs?: number | false;
  readonly importLegacy?: (
    daveBuiltin: ProviderConfigLayerSnapshot,
  ) => Promise<ProviderConfigLayerUpdate | null>;
  readonly watch?: boolean;
}

/** 组装一个 Node.js 进程内共享的 Dave Built-in/Personal Config 运行边界。 */
export class NodeProviderConfigRuntime {
  readonly configService: ProviderConfigService;
  readonly #daveBuiltinSource:
    | NodeDaveBuiltinProviderConfigSource
    | EndpointScopedDaveBuiltinSource;
  readonly #personalRepository: NodePersonalProviderConfigRepository;
  readonly #remoteSynchronizer?: DaveBuiltinRemoteSynchronizer;
  readonly #onRemoteRefreshError?: (error: unknown) => void;
  #startPromise: Promise<void> | null = null;
  #disposed = false;
  readonly #checkListeners = new Set<() => Promise<void>>();
  #checkTimer: ReturnType<typeof setInterval> | null = null;
  #checkInFlight: Promise<void> | null = null;

  constructor(options: NodeProviderConfigRuntimeOptions) {
    this.#daveBuiltinSource = options.daveBuiltinEnvironment
      ? new EndpointScopedDaveBuiltinSource({
          bundledFilePath: options.daveBuiltinFilePath,
          ...options.daveBuiltinEnvironment,
        })
      : new NodeDaveBuiltinProviderConfigSource({
          bundledFilePath: options.daveBuiltinFilePath,
          activeFilePath: options.daveBuiltinActiveFilePath,
          watch: options.watch,
        });
    this.#remoteSynchronizer =
      options.daveBuiltinRemote &&
      this.#daveBuiltinSource instanceof NodeDaveBuiltinProviderConfigSource
        ? new DaveBuiltinRemoteSynchronizer({
            source: this.#daveBuiltinSource,
            ...options.daveBuiltinRemote,
          })
        : undefined;
    this.#onRemoteRefreshError = options.onDaveBuiltinRefreshError;
    this.#personalRepository = new NodePersonalProviderConfigRepository({
      filePath: options.personalFilePath,
      onRecovery: options.onPersonalConfigRecovery,
      onPollingError: options.onPersonalConfigPollingError,
      pollingIntervalMs: options.personalPollingIntervalMs,
      ...(options.importLegacy
        ? {
            importLegacy: async () => options.importLegacy!(await this.#daveBuiltinSource.read()),
          }
        : {}),
    });
    this.configService = new ProviderConfigService({
      daveBuiltinSource: this.#daveBuiltinSource,
      personalRepository: this.#personalRepository,
    });
  }

  resolveDaveBuiltinActiveFilePath(): Promise<string> {
    return this.#daveBuiltinSource instanceof NodeDaveBuiltinProviderConfigSource
      ? Promise.resolve(this.#daveBuiltinSource.activeFilePath)
      : this.#daveBuiltinSource.resolveActiveFilePath();
  }

  get personalRepository(): import("@dave/provider").PersonalProviderConfigRepository {
    return this.#personalRepository;
  }

  /** Environment 同一周期检查中恢复未对齐依赖，不被下载 TTL 或失败挡住。 */
  onDidCheckDaveBuiltin(listener: () => Promise<void>): () => void {
    this.#checkListeners.add(listener);
    return () => this.#checkListeners.delete(listener);
  }

  start(): Promise<void> {
    if (this.#disposed) throw new Error("NodeProviderConfigRuntime 已 dispose");
    if (this.#startPromise) return this.#startPromise;
    const startPromise = this.configService.read().then(() => {
      if (this.#disposed) return;
      void this.#checkBackground();
      // Managed Worker 无下载配置也无恢复 owner，不建立周期任务。
      if (
        this.#remoteSynchronizer ||
        this.#daveBuiltinSource instanceof EndpointScopedDaveBuiltinSource ||
        this.#checkListeners.size > 0
      ) {
        this.#checkTimer = setInterval(() => {
          void this.#checkBackground();
        }, 60_000);
        this.#checkTimer.unref?.();
      }
    });
    this.#startPromise = startPromise;
    void startPromise.catch(() => {
      if (this.#startPromise === startPromise) this.#startPromise = null;
    });
    return startPromise;
  }

  refreshDaveBuiltin(options?: { readonly force?: boolean }): Promise<DaveBuiltinRefreshResult> {
    if (this.#disposed) return Promise.resolve("disposed");
    if (this.#daveBuiltinSource instanceof EndpointScopedDaveBuiltinSource) {
      return this.#daveBuiltinSource.refresh(options);
    }
    return this.#remoteSynchronizer?.refresh(options) ?? Promise.resolve("skipped");
  }

  #checkBackground(): Promise<void> {
    if (this.#disposed) return Promise.resolve();
    if (this.#checkInFlight) return this.#checkInFlight;
    const check = Promise.allSettled([
      this.refreshDaveBuiltin(),
      ...[...this.#checkListeners].map((listener) => Promise.resolve().then(listener)),
    ])
      .then((results) => {
        if (this.#disposed) return;
        for (const result of results)
          if (result.status === "rejected") this.#onRemoteRefreshError?.(result.reason);
      })
      .finally(() => {
        if (this.#checkInFlight === check) this.#checkInFlight = null;
      });
    this.#checkInFlight = check;
    return check;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    if (this.#checkTimer) clearInterval(this.#checkTimer);
    this.#checkTimer = null;
    this.#checkListeners.clear();
    this.#remoteSynchronizer?.dispose();
    this.configService.dispose();
    this.#personalRepository.dispose();
    this.#daveBuiltinSource.dispose();
  }
}

export function createNodeProviderConfigRuntime(
  options: NodeProviderConfigRuntimeOptions,
): NodeProviderConfigRuntime {
  return new NodeProviderConfigRuntime(options);
}
