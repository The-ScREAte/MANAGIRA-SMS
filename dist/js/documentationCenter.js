(function documentationCenterPage() {
  const dataElement = document.getElementById('documentation-center-data');
  if (!dataElement) return;

  const bootstrap = JSON.parse(dataElement.textContent || '{}');
  const state = {
    isAdmin: Boolean(bootstrap.isDocumentationAdmin),
    articleIndex: Array.isArray(bootstrap.articleIndex) ? bootstrap.articleIndex.slice() : [],
    availableTopics: Array.isArray(bootstrap.availableTopics) ? bootstrap.availableTopics.slice() : [],
    quickStartResources: Array.isArray(bootstrap.quickStartResources) ? bootstrap.quickStartResources.slice() : [],
    featuredArticles: Array.isArray(bootstrap.featuredArticles) ? bootstrap.featuredArticles.slice() : [],
    selectedArticle: bootstrap.selectedArticle || null,
    articleCache: new Map(),
    activeSlug: bootstrap.selectedArticle && bootstrap.selectedArticle.slug ? bootstrap.selectedArticle.slug : null,
    editor: {
      instance: null,
      articleId: null,
      media: [],
      isPreviewVisible: false,
      uploadKind: null,
    },
    toastTimer: null,
  };

  if (state.selectedArticle && state.selectedArticle.slug) {
    state.articleCache.set(state.selectedArticle.slug, state.selectedArticle);
  }

  const refs = {};

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  function init() {
    cacheRefs();
    bindSharedEvents();
    ensureHighlightJs().finally(() => decorateArticleContent(refs.articleBody));

    if (state.isAdmin) {
      initAdminControls();
      renderManageList(state.articleIndex);
      updateTopicOptions(state.availableTopics);
    }
  }

  function cacheRefs() {
    refs.searchInput = document.getElementById('docsSearchInput');
    refs.searchResults = document.getElementById('docsSearchResults');
    refs.sidebar = document.getElementById('docsSidebar');
    refs.sidebarBackdrop = document.getElementById('docsSidebarBackdrop');
    refs.sidebarToggle = document.getElementById('docsSidebarToggle');
    refs.sidebarClose = document.getElementById('docsSidebarClose');
    refs.homeView = document.getElementById('docsHomeView');
    refs.articleView = document.getElementById('docsArticleView');
    refs.articleTitle = document.getElementById('docsArticleTitle');
    refs.articleSummary = document.getElementById('docsArticleSummary');
    refs.articleBody = document.getElementById('docsArticleBody');
    refs.articleBreadcrumbs = document.getElementById('docsArticleBreadcrumbs');
    refs.articleUpdated = document.getElementById('docsArticleUpdated');
    refs.articleStatusMeta = document.getElementById('docsArticleStatusMeta');
    refs.helpfulPanel = document.getElementById('docsHelpfulPanel');
    refs.helpfulCounts = document.getElementById('docsHelpfulCounts');
    refs.canonicalLinkBtn = document.getElementById('docsCanonicalLinkBtn');
    refs.editCurrentArticleBtn = document.getElementById('docsEditCurrentArticleBtn');
    refs.toggleStatusBtn = document.getElementById('docsToggleStatusBtn');
    refs.toggleStatusLabel = document.getElementById('docsToggleStatusLabel');
    refs.lightbox = document.getElementById('docsLightbox');
    refs.lightboxImage = document.getElementById('docsLightboxImage');
    refs.toast = document.getElementById('docsToast');

    refs.manageOverlay = document.getElementById('docsManageOverlay');
    refs.manageList = document.getElementById('docsManageList');
    refs.manageSearchInput = document.getElementById('docsManageSearchInput');
    refs.newArticleBtn = document.getElementById('docsNewArticleBtn');
    refs.manageArticlesBtn = document.getElementById('docsManageArticlesBtn');
    refs.editorOverlay = document.getElementById('docsEditorOverlay');
    refs.editorHeading = document.getElementById('docsEditorHeading');
    refs.editorTitle = document.getElementById('docsEditorTitle');
    refs.editorTopic = document.getElementById('docsEditorTopic');
    refs.editorSubtopic = document.getElementById('docsEditorSubtopic');
    refs.editorTags = document.getElementById('docsEditorTags');
    refs.editorSeoDescription = document.getElementById('docsEditorSeoDescription');
    refs.editorFeatured = document.getElementById('docsEditorFeatured');
    refs.editorStatusText = document.getElementById('docsEditorStatusText');
    refs.previewToggleBtn = document.getElementById('docsPreviewToggleBtn');
    refs.previewRefreshBtn = document.getElementById('docsPreviewRefreshBtn');
    refs.editorCanvas = document.getElementById('docsEditorCanvas');
    refs.editorPreview = document.getElementById('docsEditorPreview');
    refs.previewBreadcrumbs = document.getElementById('docsPreviewBreadcrumbs');
    refs.previewTitle = document.getElementById('docsPreviewTitle');
    refs.previewSummary = document.getElementById('docsPreviewSummary');
    refs.previewBody = document.getElementById('docsPreviewBody');
    refs.saveDraftBtn = document.getElementById('docsSaveDraftBtn');
    refs.publishBtn = document.getElementById('docsPublishArticleBtn');
    refs.deleteArticleBtn = document.getElementById('docsDeleteArticleBtn');
    refs.duplicateArticleBtn = document.getElementById('docsDuplicateArticleBtn');
    refs.mediaFileInput = document.getElementById('docsMediaFileInput');
    refs.topicOptions = document.getElementById('docsTopicOptions');
  }

  function bindSharedEvents() {
    if (refs.searchInput) {
      refs.searchInput.addEventListener('input', handleSearchInput);
      refs.searchInput.addEventListener('keydown', handleSearchKeydown);
    }

    if (refs.sidebarToggle) refs.sidebarToggle.addEventListener('click', openSidebar);
    if (refs.sidebarClose) refs.sidebarClose.addEventListener('click', closeSidebar);
    if (refs.sidebarBackdrop) refs.sidebarBackdrop.addEventListener('click', closeSidebar);
    if (refs.lightbox) refs.lightbox.addEventListener('click', closeLightbox);

    document.addEventListener('click', handleDocumentClick);

    document.querySelectorAll('[data-doc-article-link]').forEach((link) => {
      link.addEventListener('click', handleArticleLinkClick);
    });

    if (refs.canonicalLinkBtn) {
      refs.canonicalLinkBtn.addEventListener('click', copyDirectLink);
    }

    if (refs.helpfulPanel) {
      refs.helpfulPanel.addEventListener('click', handleHelpfulVote);
    }

    if (refs.editCurrentArticleBtn) {
      refs.editCurrentArticleBtn.addEventListener('click', () => {
        if (!state.selectedArticle) return;
        openEditorForSlug(state.selectedArticle.slug);
      });
    }

    if (refs.toggleStatusBtn) {
      refs.toggleStatusBtn.addEventListener('click', toggleCurrentArticleStatus);
    }

    window.addEventListener('popstate', handlePopState);
  }

  function normalizeText(value) {
    return String(value || '').toLowerCase().trim();
  }

  function tokenize(query) {
    return normalizeText(query).split(/\s+/).filter(Boolean);
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

  function handleSearchInput(event) {
    const query = event.target.value.trim();
    if (!query) {
      hideSearchResults();
      return;
    }

    const matches = searchArticles(query, 8);
    renderSearchResults(matches, query);
  }

  function handleSearchKeydown(event) {
    if (event.key === 'Escape') {
      hideSearchResults();
      event.target.blur();
      return;
    }

    if (event.key === 'Enter') {
      const firstMatch = refs.searchResults && refs.searchResults.querySelector('[data-result-slug]');
      if (firstMatch) {
        event.preventDefault();
        openArticleBySlug(firstMatch.getAttribute('data-result-slug'), true);
      }
    }
  }

  function renderSearchResults(results, query) {
    if (!refs.searchResults) return;

    if (!results.length) {
      refs.searchResults.innerHTML = '<div class="docs-search-result"><strong>No article matched that search yet.</strong><p>Try a broader term or browse the topics in the left sidebar.</p></div>';
      refs.searchResults.classList.add('is-visible');
      return;
    }

    refs.searchResults.innerHTML = results.map((article) => {
      const breadcrumb = [article.topic, article.subtopic].filter(Boolean).join(' / ');
      return `
        <div class="docs-search-result" data-result-slug="${escapeAttribute(article.slug)}" tabindex="0" role="button">
          <span class="docs-search-result__meta">${escapeHtml(breadcrumb || 'Documentation article')}</span>
          <strong>${highlightMatch(article.title, query)}</strong>
          <p>${highlightMatch(article.seoDescription || article.excerpt || '', query)}</p>
        </div>
      `;
    }).join('');

    refs.searchResults.classList.add('is-visible');
    refs.searchResults.querySelectorAll('[data-result-slug]').forEach((item) => {
      item.addEventListener('click', () => {
        openArticleBySlug(item.getAttribute('data-result-slug'), true);
      });

      item.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openArticleBySlug(item.getAttribute('data-result-slug'), true);
        }
      });
    });
  }

  function hideSearchResults() {
    if (!refs.searchResults) return;
    refs.searchResults.classList.remove('is-visible');
    refs.searchResults.innerHTML = '';
  }

  function handleDocumentClick(event) {
    if (refs.searchResults && refs.searchInput) {
      const insideSearch = refs.searchResults.contains(event.target) || refs.searchInput.contains(event.target);
      if (!insideSearch) hideSearchResults();
    }

    const editBtn = event.target.closest('[data-doc-edit-slug]');
    if (editBtn && state.isAdmin) {
      event.preventDefault();
      event.stopPropagation();
      openEditorForSlug(editBtn.getAttribute('data-doc-edit-slug'));
      return;
    }
  }

  function handleArticleLinkClick(event) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    const slug = event.currentTarget.getAttribute('data-slug');
    openArticleBySlug(slug, true);
  }

  function openSidebar() {
    if (refs.sidebar) refs.sidebar.classList.add('is-open');
    if (refs.sidebarBackdrop) refs.sidebarBackdrop.classList.add('is-open');
  }

  function closeSidebar() {
    if (refs.sidebar) refs.sidebar.classList.remove('is-open');
    if (refs.sidebarBackdrop) refs.sidebarBackdrop.classList.remove('is-open');
  }

  function openLightbox(src, alt) {
    if (!refs.lightbox || !refs.lightboxImage) return;
    refs.lightboxImage.src = src;
    refs.lightboxImage.alt = alt || 'Expanded documentation image';
    refs.lightbox.classList.add('is-open');
  }

  function closeLightbox() {
    if (!refs.lightbox || !refs.lightboxImage) return;
    refs.lightbox.classList.remove('is-open');
    refs.lightboxImage.src = '';
  }

  function formatDate(value) {
    if (!value) return 'Recently updated';
    try {
      return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch (_) {
      return 'Recently updated';
    }
  }

  async function openArticleBySlug(slug, pushState) {
    if (!slug) return;

    try {
      closeManageOverlay();
      const article = await getArticle(slug);
      renderArticle(article, pushState);
      closeSidebar();
      hideSearchResults();
      if (refs.searchInput) refs.searchInput.value = '';
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (_) {
      showToast('Unable to load that article right now.', true);
    }
  }

  function renderArticle(article, pushState) {
    state.selectedArticle = article;
    state.activeSlug = article.slug;
    state.articleCache.set(article.slug, article);

    if (refs.homeView) refs.homeView.classList.add('is-hidden');
    if (refs.articleView) refs.articleView.classList.add('is-active');
    if (refs.articleTitle) refs.articleTitle.textContent = article.title || '';
    if (refs.articleSummary) refs.articleSummary.textContent = article.seoDescription || article.excerpt || '';
    if (refs.articleBody) refs.articleBody.innerHTML = article.contentHtml || '';
    if (refs.articleBreadcrumbs) refs.articleBreadcrumbs.innerHTML = renderBreadcrumb(article.breadcrumb || []);
    if (refs.articleUpdated) refs.articleUpdated.innerHTML = `<i class="fas fa-clock"></i> ${escapeHtml(formatDate(article.updatedAt))}`;

    if (refs.articleStatusMeta) {
      refs.articleStatusMeta.innerHTML = state.isAdmin
        ? `<span class="docs-status-pill ${article.status === 'draft' ? 'is-draft' : ''}">${escapeHtml(article.status)}</span>`
        : '';
    }

    if (refs.helpfulPanel) refs.helpfulPanel.hidden = false;
    if (refs.helpfulCounts) {
      refs.helpfulCounts.textContent = `${Number(article.helpfulYes || 0)} helpful / ${Number(article.helpfulNo || 0)} not helpful`;
    }

    if (refs.canonicalLinkBtn) {
      refs.canonicalLinkBtn.href = `/legal/user-documentation/${article.slug}`;
    }

    if (refs.editCurrentArticleBtn) refs.editCurrentArticleBtn.disabled = false;
    if (refs.toggleStatusBtn) refs.toggleStatusBtn.disabled = false;
    if (refs.toggleStatusLabel) refs.toggleStatusLabel.textContent = article.status === 'active' ? 'Move to Draft' : 'Publish Article';

    decorateArticleContent(refs.articleBody);
    syncActiveNavigation(article.slug);
    updateDocumentMeta(article);

    if (pushState) {
      window.history.pushState({ slug: article.slug }, '', `/legal/user-documentation/${article.slug}`);
    }
  }

  function renderHome(pushState) {
    state.activeSlug = null;
    if (refs.homeView) refs.homeView.classList.remove('is-hidden');
    if (refs.articleView) refs.articleView.classList.remove('is-active');
    if (refs.helpfulPanel) refs.helpfulPanel.hidden = true;
    if (refs.editCurrentArticleBtn) refs.editCurrentArticleBtn.disabled = true;
    if (refs.toggleStatusBtn) refs.toggleStatusBtn.disabled = true;
    syncActiveNavigation(null);
    updateDocumentMeta(null);
    if (pushState) {
      window.history.pushState({}, '', '/legal/user-documentation');
    }
  }

  function renderBreadcrumb(items) {
    return items.map((item) => `<span>${escapeHtml(item)}</span>`).join('');
  }

  function syncActiveNavigation(slug) {
    document.querySelectorAll('.docs-nav-link').forEach((card) => {
      const link = card.querySelector('[data-doc-article-link]');
      card.classList.toggle('is-active', Boolean(link && slug && link.getAttribute('data-slug') === slug));

      if (slug && link && link.getAttribute('data-slug') === slug) {
        const topic = card.closest('details');
        if (topic) topic.open = true;
        const parentTopic = card.closest('.docs-topic');
        if (parentTopic) parentTopic.open = true;
      }
    });
  }

  function updateDocumentMeta(article) {
    document.title = article ? `${article.title} - Managira Documentation` : 'User Documentation - Managira';

    updateMetaTag('description', article ? (article.seoDescription || article.excerpt || '') : 'Structured documentation, quick start guides, and searchable help articles for Managira.');
    updateMetaTag('keywords', article ? (article.tags || []).join(', ') : 'managira documentation, help center, user guide, school management documentation');

    const canonical = document.querySelector('link[rel="canonical"]');
    if (canonical) canonical.href = article ? `${window.location.origin}/legal/user-documentation/${article.slug}` : `${window.location.origin}/legal/user-documentation`;
  }

  function updateMetaTag(name, value) {
    const tag = document.querySelector(`meta[name="${name}"]`);
    if (tag) tag.setAttribute('content', value || '');
  }

  async function getArticle(slug) {
    if (state.articleCache.has(slug)) {
      return state.articleCache.get(slug);
    }

    const response = await fetch(`/legal/user-documentation/api/article/${encodeURIComponent(slug)}`, {
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
    });

    const payload = await response.json();
    if (!response.ok || !payload.success || !payload.article) {
      throw new Error(payload.message || 'Article not found');
    }

    state.articleCache.set(slug, payload.article);
    return payload.article;
  }

  function decorateArticleContent(container) {
    if (!container) return;

    decorateHeadings(container);
    container.querySelectorAll('img.doc-inline-image').forEach((image) => {
      image.addEventListener('click', () => openLightbox(image.getAttribute('src'), image.getAttribute('alt')));
    });

    if (window.hljs) {
      container.querySelectorAll('pre code').forEach((block) => {
        window.hljs.highlightElement(block);
      });
    }
  }

  function decorateHeadings(container) {
    container.querySelectorAll('h2, h3, h4').forEach((heading) => {
      const text = heading.textContent.trim();
      if (!text) return;

      if (!heading.id) {
        heading.id = slugify(text);
      }

      if (heading.querySelector('.docs-anchor-link')) return;

      const anchor = document.createElement('a');
      anchor.href = `#${heading.id}`;
      anchor.className = 'docs-anchor-link';
      anchor.setAttribute('aria-label', `Copy section link for ${text}`);
      anchor.innerHTML = '<i class="fas fa-link"></i>';
      anchor.addEventListener('click', function handleAnchorClick(event) {
        event.preventDefault();
        window.history.replaceState(window.history.state || {}, '', `${window.location.pathname}#${heading.id}`);
        copyTextToClipboard(`${window.location.origin}${window.location.pathname}#${heading.id}`);
        showToast('Section link copied.');
      });

      heading.appendChild(anchor);
    });
  }

  function slugify(value) {
    return String(value || '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'section';
  }

  async function copyDirectLink(event) {
    event.preventDefault();
    const href = refs.canonicalLinkBtn ? refs.canonicalLinkBtn.href : window.location.href;
    await copyTextToClipboard(href);
    showToast('Direct article link copied.');
  }

  async function copyTextToClipboard(value) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(value);
      return;
    }

    const field = document.createElement('textarea');
    field.value = value;
    document.body.appendChild(field);
    field.select();
    document.execCommand('copy');
    field.remove();
  }

  async function handleHelpfulVote(event) {
    const button = event.target.closest('[data-doc-helpful-vote]');
    if (!button || !state.selectedArticle) return;

    const vote = button.getAttribute('data-doc-helpful-vote');
    try {
      const payload = await fetchJson('/legal/user-documentation/api/helpful', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ articleId: state.selectedArticle.id, vote }),
      });

      state.selectedArticle.helpfulYes = payload.counts.helpfulYes;
      state.selectedArticle.helpfulNo = payload.counts.helpfulNo;
      if (refs.helpfulCounts) {
        refs.helpfulCounts.textContent = `${payload.counts.helpfulYes} helpful / ${payload.counts.helpfulNo} not helpful`;
      }
      showToast('Thanks. Your feedback was saved.');
    } catch (error) {
      showToast(error.message || 'Unable to save article feedback.', true);
    }
  }

  function handlePopState() {
    const path = window.location.pathname.replace(/\/+$/, '');
    const match = path.match(/\/legal\/user-documentation\/([^/]+)$/);
    if (match && match[1]) {
      openArticleBySlug(match[1], false);
      return;
    }

    renderHome(false);
  }

  function showToast(message, isError) {
    if (!refs.toast) return;
    refs.toast.textContent = message;
    refs.toast.style.background = isError ? '#991b1b' : '#10243e';
    refs.toast.classList.add('is-visible');
    window.clearTimeout(state.toastTimer);
    state.toastTimer = window.setTimeout(() => refs.toast.classList.remove('is-visible'), 2600);
  }

  async function fetchJson(url, options) {
    const response = await fetch(url, options);
    const payload = await response.json();
    if (!response.ok || !payload.success) {
      throw new Error(payload.message || 'Request failed');
    }
    return payload;
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

  function initAdminControls() {
    ensureEditor();

    if (refs.newArticleBtn) refs.newArticleBtn.addEventListener('click', () => openEditor(null));
    if (refs.manageArticlesBtn) refs.manageArticlesBtn.addEventListener('click', openManageOverlay);
    document.querySelectorAll('[data-doc-close-manage]').forEach((button) => button.addEventListener('click', closeManageOverlay));
    document.querySelectorAll('[data-doc-close-editor]').forEach((button) => button.addEventListener('click', closeEditor));

    if (refs.manageSearchInput) {
      refs.manageSearchInput.addEventListener('input', function handleManageSearch() {
        renderManageList(filterManageArticles(this.value));
      });
    }

    if (refs.previewToggleBtn) refs.previewToggleBtn.addEventListener('click', togglePreview);
    if (refs.previewRefreshBtn) refs.previewRefreshBtn.addEventListener('click', refreshPreview);
    if (refs.saveDraftBtn) refs.saveDraftBtn.addEventListener('click', () => saveEditorArticle('draft'));
    if (refs.publishBtn) refs.publishBtn.addEventListener('click', () => saveEditorArticle('active'));
    if (refs.duplicateArticleBtn) refs.duplicateArticleBtn.addEventListener('click', duplicateEditorArticle);
    if (refs.deleteArticleBtn) refs.deleteArticleBtn.addEventListener('click', deleteEditorArticle);

    document.querySelectorAll('[data-doc-insert-block]').forEach((button) => {
      button.addEventListener('click', () => insertEditorBlock(button.getAttribute('data-doc-insert-block')));
    });

    document.querySelectorAll('[data-doc-upload-kind]').forEach((button) => {
      button.addEventListener('click', () => {
        state.editor.uploadKind = button.getAttribute('data-doc-upload-kind');
        if (!refs.mediaFileInput) return;
        refs.mediaFileInput.accept = buildAcceptString(state.editor.uploadKind);
        refs.mediaFileInput.value = '';
        refs.mediaFileInput.click();
      });
    });

    if (refs.mediaFileInput) {
      refs.mediaFileInput.addEventListener('change', handleEditorUpload);
    }

    if (refs.editorOverlay) {
      refs.editorOverlay.addEventListener('click', (event) => {
        if (event.target === refs.editorOverlay) closeEditor();
      });
    }

    if (refs.manageOverlay) {
      refs.manageOverlay.addEventListener('click', (event) => {
        if (event.target === refs.manageOverlay) closeManageOverlay();
      });
    }
  }

  function ensureEditor() {
    if (state.editor.instance || !document.getElementById('docsEditor') || !window.Quill) return;

    state.editor.instance = new window.Quill('#docsEditor', {
      theme: 'snow',
      modules: {
        toolbar: [
          [{ header: [2, 3, 4, false] }],
          ['bold', 'italic', 'underline', 'strike'],
          [{ list: 'ordered' }, { list: 'bullet' }],
          ['blockquote', 'code-block'],
          ['link'],
          ['clean'],
        ],
      },
      placeholder: 'Write the article steps, context, callouts, media, and references here...',
    });
  }

  function openManageOverlay() {
    if (!refs.manageOverlay) return;
    refs.manageOverlay.classList.add('is-open');
    syncBodyScrollLock();
  }

  function closeManageOverlay() {
    if (!refs.manageOverlay) return;
    refs.manageOverlay.classList.remove('is-open');
    syncBodyScrollLock();
  }

  function openEditor(article) {
    if (!refs.editorOverlay || !state.editor.instance) return;
    closeManageOverlay();
    refs.editorOverlay.classList.add('is-open');
    syncBodyScrollLock();
    state.editor.isPreviewVisible = false;
    refs.editorCanvas.classList.remove('is-hidden');
    refs.editorPreview.classList.remove('is-visible');
    if (refs.previewToggleBtn) refs.previewToggleBtn.innerHTML = '<i class="fas fa-eye"></i> Preview';

    const current = article || createBlankArticle();
    state.editor.articleId = current.id || null;
    state.editor.media = Array.isArray(current.media) ? current.media.slice() : [];
    if (refs.editorHeading) refs.editorHeading.textContent = current.id ? 'Edit Documentation Article' : 'Create Documentation Article';
    if (refs.editorTitle) refs.editorTitle.value = current.title || '';
    if (refs.editorTopic) refs.editorTopic.value = current.topic || '';
    if (refs.editorSubtopic) refs.editorSubtopic.value = current.subtopic || '';
    if (refs.editorTags) refs.editorTags.value = Array.isArray(current.tags) ? current.tags.join(', ') : '';
    if (refs.editorSeoDescription) refs.editorSeoDescription.value = current.seoDescription || '';
    if (refs.editorFeatured) refs.editorFeatured.checked = Boolean(current.featured);
    if (state.editor.instance) {
      state.editor.instance.root.innerHTML = current.contentHtml || '<p></p>';
    }
    if (refs.editorStatusText) refs.editorStatusText.textContent = current.id ? `Editing ${current.title}` : 'Creating a new article.';
    if (refs.deleteArticleBtn) refs.deleteArticleBtn.disabled = !current.id;
    if (refs.duplicateArticleBtn) refs.duplicateArticleBtn.disabled = !current.id;
  }

  function closeEditor() {
    if (!refs.editorOverlay) return;
    refs.editorOverlay.classList.remove('is-open');
    syncBodyScrollLock();
  }

  async function openEditorForSlug(slug) {
    try {
      const article = await getArticle(slug);
      openEditor(article);
    } catch (error) {
      showToast(error.message || 'Unable to open article editor.', true);
    }
  }

  function createBlankArticle() {
    return {
      title: '',
      topic: state.availableTopics[0] || '',
      subtopic: '',
      tags: [],
      seoDescription: '',
      featured: false,
      contentHtml: '<h2>Overview</h2><p></p><h2>Steps</h2><ol><li></li></ol>',
      media: [],
    };
  }

  function getEditorPayload(status) {
    return {
      title: refs.editorTitle ? refs.editorTitle.value.trim() : '',
      topic: refs.editorTopic ? refs.editorTopic.value.trim() : '',
      subtopic: refs.editorSubtopic ? refs.editorSubtopic.value.trim() : '',
      tags: refs.editorTags ? refs.editorTags.value.trim() : '',
      seoDescription: refs.editorSeoDescription ? refs.editorSeoDescription.value.trim() : '',
      featured: refs.editorFeatured ? refs.editorFeatured.checked : false,
      status,
      contentHtml: state.editor.instance ? state.editor.instance.root.innerHTML : '',
      media: state.editor.media,
    };
  }

  async function saveEditorArticle(status) {
    if (!state.editor.instance) return;

    const payload = getEditorPayload(status);
    if (!payload.title || !payload.topic) {
      showToast('Title and topic are required before saving.', true);
      return;
    }

    const url = state.editor.articleId
      ? `/legal/user-documentation/api/articles/${state.editor.articleId}`
      : '/legal/user-documentation/api/articles';

    try {
      if (refs.editorStatusText) refs.editorStatusText.textContent = 'Saving article...';
      const response = await fetchJson(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(payload),
      });

      state.articleIndex = Array.isArray(response.index) ? response.index.slice() : state.articleIndex;
      state.availableTopics = Array.isArray(response.topics) ? response.topics.slice() : state.availableTopics;
      state.articleCache.set(response.article.slug, response.article);
      updateTopicOptions(state.availableTopics);
      renderManageList(filterManageArticles(refs.manageSearchInput ? refs.manageSearchInput.value : ''));
      renderArticle(response.article, true);
      closeEditor();
      showToast(status === 'active' ? 'Article published.' : 'Draft saved.');
    } catch (error) {
      showToast(error.message || 'Unable to save article.', true);
      if (refs.editorStatusText) refs.editorStatusText.textContent = 'Save failed.';
    }
  }

  async function toggleCurrentArticleStatus() {
    if (!state.isAdmin || !state.selectedArticle) return;
    const nextStatus = state.selectedArticle.status === 'active' ? 'draft' : 'active';

    try {
      const response = await fetchJson(`/legal/user-documentation/api/articles/${state.selectedArticle.id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ status: nextStatus }),
      });

      state.articleIndex = Array.isArray(response.index) ? response.index.slice() : state.articleIndex;
      state.articleCache.set(response.article.slug, response.article);
      renderManageList(filterManageArticles(refs.manageSearchInput ? refs.manageSearchInput.value : ''));
      renderArticle(response.article, false);
      showToast(nextStatus === 'active' ? 'Article published.' : 'Article moved to draft.');
    } catch (error) {
      showToast(error.message || 'Unable to change article status.', true);
    }
  }

  async function duplicateEditorArticle() {
    if (!state.editor.articleId) return;
    try {
      const response = await fetchJson(`/legal/user-documentation/api/articles/${state.editor.articleId}/duplicate`, {
        method: 'POST',
        headers: { Accept: 'application/json' },
        credentials: 'same-origin',
      });

      state.articleIndex = Array.isArray(response.index) ? response.index.slice() : state.articleIndex;
      state.availableTopics = Array.isArray(response.topics) ? response.topics.slice() : state.availableTopics;
      state.articleCache.set(response.article.slug, response.article);
      updateTopicOptions(state.availableTopics);
      renderManageList(filterManageArticles(refs.manageSearchInput ? refs.manageSearchInput.value : ''));
      openEditor(response.article);
      showToast('Draft copy created.');
    } catch (error) {
      showToast(error.message || 'Unable to duplicate article.', true);
    }
  }

  async function deleteEditorArticle() {
    if (!state.editor.articleId) return;
    if (!window.confirm('Delete this documentation article permanently?')) return;

    try {
      const response = await fetchJson(`/legal/user-documentation/api/articles/${state.editor.articleId}/delete`, {
        method: 'POST',
        headers: { Accept: 'application/json' },
        credentials: 'same-origin',
      });

      state.articleIndex = Array.isArray(response.index) ? response.index.slice() : state.articleIndex;
      state.availableTopics = Array.isArray(response.topics) ? response.topics.slice() : state.availableTopics;
      if (state.selectedArticle && state.selectedArticle.id === response.deletedId) {
        renderHome(true);
      }
      closeEditor();
      renderManageList(filterManageArticles(refs.manageSearchInput ? refs.manageSearchInput.value : ''));
      showToast('Article deleted.');
    } catch (error) {
      showToast(error.message || 'Unable to delete article.', true);
    }
  }

  function filterManageArticles(query) {
    const normalizedQuery = normalizeText(query);
    if (!normalizedQuery) return state.articleIndex.slice();

    return state.articleIndex.filter((article) => {
      const haystack = [
        article.title,
        article.topic,
        article.subtopic,
        article.status,
        (article.tags || []).join(' '),
        article.seoDescription,
      ].join(' ').toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }

  function renderManageList(articles) {
    if (!refs.manageList) return;

    if (!articles.length) {
      refs.manageList.innerHTML = '<div class="docs-empty-state">No article matched that filter.</div>';
      return;
    }

    refs.manageList.innerHTML = articles.map((article) => `
      <article class="docs-manage-item">
        <div>
          <h3>${escapeHtml(article.title)}</h3>
          <p>${escapeHtml([article.topic, article.subtopic, article.status].filter(Boolean).join(' / '))}</p>
        </div>
        <div class="docs-manage-item__actions">
          <a class="docs-btn--ghost" href="/legal/user-documentation/${escapeAttribute(article.slug)}" data-doc-article-link data-slug="${escapeAttribute(article.slug)}">
            <i class="fas fa-book"></i> View
          </a>
          <button type="button" class="docs-btn--ghost" data-manage-edit="${escapeAttribute(article.slug)}"><i class="fas fa-pen"></i> Edit</button>
          <button type="button" class="docs-btn--ghost" data-manage-status="${article.id}" data-next-status="${article.status === 'active' ? 'draft' : 'active'}">
            <i class="fas fa-toggle-on"></i> ${article.status === 'active' ? 'Draft' : 'Publish'}
          </button>
        </div>
      </article>
    `).join('');

    refs.manageList.querySelectorAll('[data-doc-article-link]').forEach((link) => {
      link.addEventListener('click', handleArticleLinkClick);
    });

    refs.manageList.querySelectorAll('[data-manage-edit]').forEach((button) => {
      button.addEventListener('click', () => openEditorForSlug(button.getAttribute('data-manage-edit')));
    });

    refs.manageList.querySelectorAll('[data-manage-status]').forEach((button) => {
      button.addEventListener('click', async () => {
        try {
          const response = await fetchJson(`/legal/user-documentation/api/articles/${button.getAttribute('data-manage-status')}/status`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ status: button.getAttribute('data-next-status') }),
          });

          state.articleIndex = Array.isArray(response.index) ? response.index.slice() : state.articleIndex;
          state.articleCache.set(response.article.slug, response.article);
          renderManageList(filterManageArticles(refs.manageSearchInput ? refs.manageSearchInput.value : ''));
          if (state.selectedArticle && state.selectedArticle.id === response.article.id) {
            renderArticle(response.article, false);
          }
          showToast('Article status updated.');
        } catch (error) {
          showToast(error.message || 'Unable to update article status.', true);
        }
      });
    });
  }

  function updateTopicOptions(topics) {
    if (!refs.topicOptions) return;
    refs.topicOptions.innerHTML = (topics || []).map((topic) => `<option value="${escapeAttribute(topic)}"></option>`).join('');
  }

  function syncBodyScrollLock() {
    const editorOpen = refs.editorOverlay && refs.editorOverlay.classList.contains('is-open');
    const manageOpen = refs.manageOverlay && refs.manageOverlay.classList.contains('is-open');
    document.body.style.overflow = editorOpen || manageOpen ? 'hidden' : '';
  }

  function ensureHighlightJs() {
    if (window.hljs) {
      return Promise.resolve();
    }

    if (document.querySelector('[data-doc-highlight-script]')) {
      return Promise.resolve();
    }

    const stylesheet = document.createElement('link');
    stylesheet.rel = 'stylesheet';
    stylesheet.href = 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.10.0/styles/github-dark.min.css';
    stylesheet.setAttribute('data-doc-highlight-style', 'true');
    document.head.appendChild(stylesheet);

    return new Promise((resolve) => {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.10.0/highlight.min.js';
      script.defer = true;
      script.setAttribute('data-doc-highlight-script', 'true');
      script.addEventListener('load', resolve, { once: true });
      script.addEventListener('error', resolve, { once: true });
      document.head.appendChild(script);
    });
  }

  function togglePreview() {
    state.editor.isPreviewVisible = !state.editor.isPreviewVisible;
    if (state.editor.isPreviewVisible) {
      refreshPreview();
      refs.editorCanvas.classList.add('is-hidden');
      refs.editorPreview.classList.add('is-visible');
      refs.previewToggleBtn.innerHTML = '<i class="fas fa-pen"></i> Edit';
      return;
    }

    refs.editorCanvas.classList.remove('is-hidden');
    refs.editorPreview.classList.remove('is-visible');
    refs.previewToggleBtn.innerHTML = '<i class="fas fa-eye"></i> Preview';
  }

  function refreshPreview() {
    if (!refs.previewBody) return;
    const topic = refs.editorTopic ? refs.editorTopic.value.trim() : '';
    const subtopic = refs.editorSubtopic ? refs.editorSubtopic.value.trim() : '';
    if (refs.previewBreadcrumbs) refs.previewBreadcrumbs.innerHTML = renderBreadcrumb([topic, subtopic].filter(Boolean));
    if (refs.previewTitle) refs.previewTitle.textContent = refs.editorTitle ? refs.editorTitle.value.trim() : '';
    if (refs.previewSummary) refs.previewSummary.textContent = refs.editorSeoDescription ? refs.editorSeoDescription.value.trim() : '';
    refs.previewBody.innerHTML = state.editor.instance ? state.editor.instance.root.innerHTML : '';
    decorateArticleContent(refs.previewBody);
  }

  function insertEditorBlock(type) {
    if (!state.editor.instance) return;

    const selection = state.editor.instance.getSelection(true);
    const index = selection ? selection.index : state.editor.instance.getLength();
    let html = '';

    if (type === 'callout-tip') {
      html = '<div class="doc-callout doc-callout--tip"><strong>Tip:</strong> Add practical advice here.</div><p><br></p>';
    } else if (type === 'callout-warning') {
      html = '<div class="doc-callout doc-callout--warning"><strong>Warning:</strong> Call out the risk, dependency, or limitation here.</div><p><br></p>';
    } else if (type === 'callout-info') {
      html = '<div class="doc-callout doc-callout--info"><strong>Info:</strong> Add extra context here.</div><p><br></p>';
    } else if (type === 'divider') {
      html = '<hr class="doc-divider"><p><br></p>';
    } else if (type === 'table') {
      html = '<table><thead><tr><th>Column 1</th><th>Column 2</th></tr></thead><tbody><tr><td>Value</td><td>Value</td></tr></tbody></table><p><br></p>';
    } else if (type === 'link') {
      const linkText = window.prompt('Link text');
      if (!linkText) return;
      const href = window.prompt('Destination URL or internal path', '/legal/user-documentation');
      if (!href) return;
      html = `<p><a href="${escapeAttribute(href)}">${escapeHtml(linkText)}</a></p>`;
    } else if (type === 'youtube') {
      const youtubeUrl = window.prompt('Paste the YouTube URL');
      const embedUrl = buildYouTubeEmbedUrl(youtubeUrl);
      if (!embedUrl) {
        showToast('Use a valid YouTube URL.', true);
        return;
      }
      html = `<figure class="doc-media doc-video"><iframe class="doc-youtube-embed" src="${embedUrl}" title="Embedded video" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen loading="lazy"></iframe></figure><p><br></p>`;
    }

    if (!html) return;
    state.editor.instance.clipboard.dangerouslyPasteHTML(index, html);
    state.editor.instance.setSelection(index + 1, 0);
  }

  function buildYouTubeEmbedUrl(url) {
    const value = String(url || '').trim();
    if (!value) return '';

    const shortMatch = value.match(/youtu\.be\/([a-zA-Z0-9_-]{6,})/i);
    const longMatch = value.match(/[?&]v=([a-zA-Z0-9_-]{6,})/i);
    const id = shortMatch ? shortMatch[1] : (longMatch ? longMatch[1] : '');
    return id ? `https://www.youtube-nocookie.com/embed/${id}` : '';
  }

  function buildAcceptString(kind) {
    if (kind === 'image') return 'image/*';
    if (kind === 'video') return 'video/*';
    return '.pdf,.doc,.docx,.xls,.xlsx,.txt';
  }

  async function handleEditorUpload(event) {
    const file = event.target.files && event.target.files[0];
    if (!file || !state.editor.uploadKind) return;

    const title = window.prompt('Optional title for this upload', file.name) || '';
    const caption = state.editor.uploadKind === 'attachment'
      ? ''
      : (window.prompt('Optional caption', '') || '');
    const alt = state.editor.uploadKind === 'image'
      ? (window.prompt('Image alt text', title || file.name) || '')
      : '';

    const formData = new window.FormData();
    formData.append('file', file);
    formData.append('title', title);
    formData.append('caption', caption);
    formData.append('alt', alt);

    try {
      if (refs.editorStatusText) refs.editorStatusText.textContent = 'Uploading media...';
      const response = await fetch('/legal/user-documentation/api/media', {
        method: 'POST',
        body: formData,
        credentials: 'same-origin',
      });

      const payload = await response.json();
      if (!response.ok || !payload.success) {
        throw new Error(payload.message || 'Upload failed');
      }

      state.editor.media = mergeMedia(state.editor.media, payload.media);
      const selection = state.editor.instance.getSelection(true);
      const index = selection ? selection.index : state.editor.instance.getLength();
      state.editor.instance.clipboard.dangerouslyPasteHTML(index, `${payload.html}<p><br></p>`);
      if (refs.editorStatusText) refs.editorStatusText.textContent = 'Media uploaded.';
      showToast('Media uploaded and inserted into the article.');
    } catch (error) {
      if (refs.editorStatusText) refs.editorStatusText.textContent = 'Upload failed.';
      showToast(error.message || 'Unable to upload media.', true);
    } finally {
      state.editor.uploadKind = null;
      if (refs.mediaFileInput) refs.mediaFileInput.value = '';
    }
  }

  function mergeMedia(existing, media) {
    const list = Array.isArray(existing) ? existing.slice() : [];
    if (!media || !media.url) return list;
    if (list.some((item) => item.url === media.url)) return list;
    list.push(media);
    return list;
  }
})();