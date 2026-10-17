// The API compiles against Workers types only; tests read fixture files with this one Node function.
declare module 'node:fs' {
  export function readFileSync(path: string | URL): Uint8Array<ArrayBuffer>
}

declare const process: { env: Record<string, string | undefined> }
