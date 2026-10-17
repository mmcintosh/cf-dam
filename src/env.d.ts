/// <reference types="astro/client" />

declare namespace App {
  interface Locals {
    /** Set by src/middleware.ts on every page request; null when signed out. */
    principal: import('@cf-dam/api').Principal | null
  }
}
