(function helpCenterPage() {
  const dataElement = document.getElementById('help-center-data');
  if (!dataElement) return;

  const bootstrap = JSON.parse(dataElement.textContent || '{}');
  const state = {
    articleIndex: Array.isArray(bootstrap.articleIndex) ? bootstrap.articleIndex.slice() : [],
    quickStartResources: Array.isArray(bootstrap.quickStartResources) ? bootstrap.quickStartResources.slice() : [],
    availableTopics: Array.isArray(bootstrap.availableTopics) ? bootstrap.availableTopics.slice() : [],
    isDocumentationAdmin: Boolean(bootstrap.isDocumentationAdmin),
  };

  const refs = {};

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  function init() {
    cacheRefs();
    renderTopicChips();
    bindEvents();
    updateMessageHint();
  }

  function cacheRefs() {
    refs.searchInput = document.getElementById('helpSearchInput');
    refs.searchClear = document.getElementById('helpSearchClear');
    refs.searchMeta = document.getElementById('helpSearchMeta');
    refs.topicChips = document.getElementById('helpTopicChips');
    refs.resultsSection = document.getElementById('helpResultsSection');
    refs.articleResults = document.getElementById('helpArticleResults');
    refs.resourceResults = document.getElementById('helpResourceResults');
    refs.resourceResultsSection = document.getElementById('helpResourceResultsSection');
    refs.emptyState = document.getElementById('helpEmptyState');
    refs.defaultSection = document.getElementById('helpDefaultSection');
    refs.contactForm = document.getElementById('helpContactForm');
    refs.messageField = document.getElementById('message');
    refs.messageHint = document.getElementById('helpMessageHint');
    refs.submitButton = document.getElementById('helpSubmitBtn');
    refs.confirmHuman = document.getElementById('confirmHuman');
    refs.formStartedAt = document.getElementById('form_started_at');
  }

  function bindEvents() {
    if (refs.searchInput) {
      refs.searchInput.addEventListener('input', handleSearch);
    }

    if (refs.searchClear) {
      refs.searchClear.addEventListener('click', () => {
        refs.searchInput.value = '';
        clearSearch();
      });
    }

    if (refs.messageField) {
      refs.messageField.addEventListener('input', updateMessageHint);
    }

    if (refs.contactForm) {
      if (refs.formStartedAt) refs.formStartedAt.value = String(Date.now());

      refs.contactForm.addEventListener('submit', (event) => {
        const wordCount = countWords(refs.messageField ? refs.messageField.value : '');
        if (wordCount < 3) {
          event.preventDefault();
          updateMessageHint(true);
          return;
        }

        if (refs.confirmHuman && !refs.confirmHuman.checked) {
          event.preventDefault();
          if (refs.messageHint) refs.messageHint.textContent = 'Please confirm the request is genuine before submitting.';
          return;
        }

        if (refs.submitButton) {
          refs.submitButton.disabled = true;
          refs.submitButton.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Sending...';
        }
      });
    }
  }

  function normalizeText(value) {
    return String(value || '').toLowerCase().trim();
  }

  function tokenize(query) {
    return normalizeText(query).split(/\s+/).filter(Boolean);
  }

  function handleSearch(event) {
    const query = String(event.target.value || '').trim();
    if (!query) {
      clearSearch();
      return;
    }

    performSearch(query);
  }

  function clearSearch() {
    if (refs.resultsSection) refs.resultsSection.classList.remove('is-visible');
    if (refs.defaultSection) refs.defaultSection.style.display = '';
    if (refs.searchMeta) refs.searchMeta.textContent = 'Search across article titles, tags, topics, summaries, and quick-start resources.';
    if (refs.articleResults) refs.articleResults.innerHTML = '';
    if (refs.resourceResults) refs.resourceResults.innerHTML = '';
    if (refs.resourceResultsSection) refs.resourceResultsSection.hidden = true;
    if (refs.emptyState) refs.emptyState.hidden = true;
    if (refs.searchClear) refs.searchClear.style.visibility = 'hidden';
    document.querySelectorAll('.help-topic-chip').forEach((chip) => chip.classList.remove('is-active'));
  }

  function performSearch(query) {
    const articleResults = searchArticles(query, 8);
    const resourceResults = searchResources(query, 6);

    if (refs.defaultSection) refs.defaultSection.style.display = 'none';
    if (refs.resultsSection) refs.resultsSection.classList.add('is-visible');
    if (refs.searchClear) refs.searchClear.style.visibility = 'visible';

    const total = articleResults.length + resourceResults.length;
    if (refs.searchMeta) {
      refs.searchMeta.textContent = total
        ? `${total} match${total === 1 ? '' : 'es'} found for “${query}”.`
        : `No strong match for “${query}” yet.`;
    }

    renderArticleResults(articleResults, query);
    renderResourceResults(resourceResults, query);
    if (refs.emptyState) refs.emptyState.hidden = total > 0;
  }

  function searchArticles(query, limit) {
    const tokens = tokenize(query);
    if (!tokens.length) return [];

    return state.articleIndex
      .map((article) => ({ article, score: scoreArticle(article, tokens) }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => {
        if (right.score !== left.score) return right.score - left.score;
        return String(right.article.updatedAt || '').localeCompare(String(left.article.updatedAt || ''));
      })
      .slice(0, limit || 8)
      .map((entry) => entry.article);
  }

  function scoreArticle(article, tokens) {
    const title = normalizeText(article.title);
    const topic = normalizeText(article.topic);
    const subtopic = normalizeText(article.subtopic);
    const summary = normalizeText(article.seoDescription || article.excerpt);
    const plainText = normalizeText(article.plainText);
    const tags = Array.isArray(article.tags) ? article.tags.map(normalizeText) : [];

    let score = 0;
    tokens.forEach((token) => {
      if (title.includes(token)) score += 8;
      if (topic.includes(token)) score += 5;
      if (subtopic.includes(token)) score += 4;
      if (summary.includes(token)) score += 3;
      if (plainText.includes(token)) score += 1;
      if (tags.some((tag) => tag.includes(token))) score += 4;
    });

    if (article.featured) score += 0.25;
    if (article.status === 'draft') score -= 0.2;
    return score;
  }

  function searchResources(query, limit) {
    const normalizedQuery = normalizeText(query);
    if (!normalizedQuery) return [];

    return state.quickStartResources
      .filter((resource) => {
        const haystack = [resource.title, resource.subtitle, resource.description, resource.url]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return haystack.includes(normalizedQuery);
      })
      .slice(0, limit || 6);
  }

  function renderArticleResults(results, query) {
    if (!refs.articleResults) return;

    if (!results.length) {
      refs.articleResults.innerHTML = '<div class="help-empty-state">No article matched that phrase yet. Try a broader task name or a page name.</div>';
      return;
    }

    refs.articleResults.innerHTML = results.map((article) => {
      const meta = [article.topic, article.subtopic, article.status === 'draft' ? 'Draft' : 'Live'].filter(Boolean).join(' / ');
      return `
        <article class="help-result-card">
          <span class="help-result-card__meta">${escapeHtml(meta)}</span>
          <h3>${highlightMatch(article.title, query)}</h3>
          <p>${highlightMatch(article.seoDescription || article.excerpt || '', query)}</p>
          <div class="help-card-actions">
            <a class="help-btn" href="/legal/user-documentation/${escapeAttribute(article.slug)}">
              <i class="fas fa-book-open"></i>
              View Article
            </a>
            <a class="help-btn--ghost" href="/legal/user-documentation#${escapeAttribute(article.slug)}">
              <i class="fas fa-arrow-right"></i>
              Open Docs Home
            </a>
          </div>
        </article>
      `;
    }).join('');
  }

  function renderResourceResults(results, query) {
    if (!refs.resourceResults || !refs.resourceResultsSection) return;

    if (!results.length) {
      refs.resourceResultsSection.hidden = true;
      refs.resourceResults.innerHTML = '';
      return;
    }

    refs.resourceResultsSection.hidden = false;
    refs.resourceResults.innerHTML = results.map((resource) => `
      <article class="help-resource-card">
        <span class="help-resource-card__meta">${escapeHtml(resource.subtitle || resource.type || 'Quick resource')}</span>
        <h3>${highlightMatch(resource.title, query)}</h3>
        <p>${highlightMatch(resource.description || '', query)}</p>
        <div class="help-card-actions">
          <a class="help-btn--ghost" href="${escapeAttribute(resource.url)}" ${resource.external ? 'target="_blank" rel="noopener noreferrer"' : ''}>
            <i class="fas fa-arrow-up-right-from-square"></i>
            Open Resource
          </a>
        </div>
      </article>
    `).join('');
  }

  function renderTopicChips() {
    if (!refs.topicChips) return;

    refs.topicChips.innerHTML = state.availableTopics.slice(0, 10).map((topic) => `
      <button type="button" class="help-topic-chip" data-topic-chip="${escapeAttribute(topic)}">
        <i class="fas fa-hashtag"></i>
        ${escapeHtml(topic)}
      </button>
    `).join('');

    refs.topicChips.querySelectorAll('[data-topic-chip]').forEach((chip) => {
      chip.addEventListener('click', () => {
        const topic = chip.getAttribute('data-topic-chip');
        if (refs.searchInput) {
          refs.searchInput.value = topic;
          performSearch(topic);
        }

        document.querySelectorAll('.help-topic-chip').forEach((button) => button.classList.remove('is-active'));
        chip.classList.add('is-active');
      });
    });
  }

  function countWords(value) {
    return String(value || '').trim().split(/\s+/).filter(Boolean).length;
  }

  function updateMessageHint(isForcedError) {
    if (!refs.messageHint || !refs.messageField) return;

    const words = countWords(refs.messageField.value);
    if (words === 0) {
      refs.messageHint.textContent = 'Include the workflow name, page name, or error you are seeing.';
      refs.messageHint.style.color = '#7a90a6';
      return;
    }

    if (words < 3 || isForcedError) {
      refs.messageHint.textContent = 'Use at least 3 words so support can identify the issue quickly.';
      refs.messageHint.style.color = '#b91c1c';
      return;
    }

    refs.messageHint.textContent = `${words} words entered. This is specific enough to submit.`;
    refs.messageHint.style.color = '#047857';
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeAttribute(value) {
    return escapeHtml(value).replace(/`/g, '&#96;');
  }

  function highlightMatch(text, query) {
    const safeText = escapeHtml(text || '');
    const normalizedQuery = String(query || '').trim();
    if (!normalizedQuery) return safeText;

    const pattern = new RegExp(`(${escapeForRegExp(normalizedQuery)})`, 'ig');
    return safeText.replace(pattern, '<mark>$1</mark>');
  }

  function escapeForRegExp(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  clearSearch();
})();