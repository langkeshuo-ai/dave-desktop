/// <reference types="vite/client" />
import type { DaveApi } from "../preload"

declare global {
  interface Window {
    dave: DaveApi
  }
}

export {}
