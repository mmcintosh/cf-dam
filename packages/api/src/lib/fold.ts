/** Lower case without accents, so "muller" finds "Müller" (D1's LIKE folds ASCII only). */
export const fold = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
