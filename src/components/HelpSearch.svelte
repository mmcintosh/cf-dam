<script lang="ts">
  import { t } from '@cf-dam/i18n/client'
  /** The help centre: every article by section, and a search over their titles, summaries and text. */
  interface Article {
    slug: string
    title: string
    summary: string
    section: string
    text: string
  }
  let { articles, sections }: { articles: Article[]; sections: string[] } = $props()
  let query = $state('')

  const words = $derived(
    query
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 1),
  )
  /** Title matches count most, then the summary, then the text; every word must appear somewhere. */
  const found = $derived(
    words.length === 0
      ? []
      : articles
          .map((a) => {
            const [title, summary, text] = [a.title, a.summary, a.text].map((s) => s.toLowerCase())
            let score = 0
            for (const w of words) {
              const hit = (title.includes(w) ? 10 : 0) + (summary.includes(w) ? 4 : 0) + (text.includes(w) ? 1 : 0)
              if (!hit) return null
              score += hit
            }
            return { a, score }
          })
          .filter((r): r is { a: Article; score: number } => r !== null)
          .sort((x, y) => y.score - x.score)
          .map((r) => r.a),
  )
</script>

<div class="stack">
  <input class="search" type="search" bind:value={query} placeholder={t('helpsearch.placeholder')} aria-label={t('helpsearch.label')} />
  {#if words.length > 0}
    <section class="stack" aria-live="polite">
      <p class="muted small">{found.length === 0 ? t('helpsearch.nothing') : t('helpsearch.found', { count: found.length })}</p>
      {#each found as a (a.slug)}
        <a class="card result" href={`/help/${a.slug}`}><strong>{a.title}</strong><span class="muted">{a.summary}</span></a>
      {/each}
    </section>
  {/if}
  <div class="sections">
    {#each sections as section (section)}
      {@const list = articles.filter((a) => a.section === section)}
      {#if list.length > 0}
        <section class="card">
          <h2>{section}</h2>
          <ul>
            {#each list as a (a.slug)}
              <li><a href={`/help/${a.slug}`}>{a.title}</a><span class="muted small">{a.summary}</span></li>
            {/each}
          </ul>
        </section>
      {/if}
    {/each}
  </div>
</div>

<style>
  .search {
    font-size: 1.05rem;
    padding: 12px 14px;
    max-width: 640px;
  }
  .result {
    display: grid;
    gap: 2px;
    text-decoration: none;
  }
  .sections {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 16px;
  }
  h2 {
    font-size: 1.05rem;
    margin: 0 0 8px;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 10px;
  }
  li {
    display: grid;
    gap: 1px;
  }
</style>
