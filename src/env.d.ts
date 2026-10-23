/// <reference types="astro/client" />

declare namespace App {
  interface Locals {
    /** Set by src/middleware.ts on every page request; null when signed out. */
    principal: import('@cf-dam/api').Principal | null
    /** The signed-in person's appearance and language choices (null when signed out). */
    preferences: import('@cf-dam/api').Preferences | null
    /** The language this page is in (packages/i18n). */
    lang: import('@cf-dam/i18n').UiLanguage
  }
}
