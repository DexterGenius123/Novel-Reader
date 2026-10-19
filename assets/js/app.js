(function(){
  "use strict";

  /* ============ STATE ============ */
  const state = {
    view: 'library',
    loading: true,
    titles: [],
    searchQuery: '',
    currentTitleId: null,
    currentChapterId: null,
    chapters: [],
    readerSettings: { fontSize: 19 },
    readerRestoreRatio: 0
  };

  const CLOTHS = [
    {bg:'#7A2E2E'}, {bg:'#2C3E5C'}, {bg:'#2E4A3A'}, {bg:'#8A5A2E'},
    {bg:'#5B3A5C'}, {bg:'#3E4A52'}, {bg:'#6B4226'}, {bg:'#3A5A5C'}, {bg:'#4A3E2E'}
  ];

  const mainEl = document.getElementById('main');
  const modalRoot = document.getElementById('modalRoot');
  const toastRoot = document.getElementById('toastRoot');
  const searchInput = document.getElementById('searchInput');
  let scrollHandlerRef = null;
  let viewRevision = 0;

  /* ============ STORAGE HELPERS ============ */
  // В обычном браузере данные сохраняются в localStorage. Поддержка
  // window.storage оставлена для совместимости с окружениями, где оно доступно.
  const hasNativeStorage = !!(window.storage && typeof window.storage.get === 'function');
  const LS_PREFIX = 'polka:';
  const localStorageAdapter = {
    async get(key){
      try{
        const raw = window.localStorage.getItem(LS_PREFIX + key);
        return raw === null ? null : { key, value: raw, shared:false };
      }catch(e){ return null; }
    },
    async set(key, value){
      try{
        window.localStorage.setItem(LS_PREFIX + key, value);
        return { key, value, shared:false };
      }catch(e){ return null; }
    },
    async delete(key){
      try{
        window.localStorage.removeItem(LS_PREFIX + key);
        return { key, deleted:true, shared:false };
      }catch(e){ return null; }
    }
  };
  const storageBackend = hasNativeStorage ? window.storage : localStorageAdapter;
  if(!hasNativeStorage){
    console.info('ПОЛКА: используется localStorage этого браузера.');
  }

  async function storeGet(key){
    try{
      const res = await storageBackend.get(key, false);
      return res ? res.value : null;
    }catch(e){ return null; }
  }
  async function storeSet(key, value){
    try{
      const res = await storageBackend.set(key, value, false);
      return !!res;
    }catch(e){ return false; }
  }
  async function storeDelete(key){
    try{ await storageBackend.delete(key, false); }catch(e){}
  }

  async function getTitles(){
    const raw = await storeGet('titles-index');
    if(!raw) return [];
    try{ return JSON.parse(raw); }catch(e){ return []; }
  }
  async function saveTitles(titles){
    return storeSet('titles-index', JSON.stringify(titles));
  }
  async function getChapters(titleId){
    const raw = await storeGet('chapters:'+titleId);
    if(!raw) return [];
    try{ return JSON.parse(raw); }catch(e){ return []; }
  }
  async function saveChapters(titleId, chapters){
    return storeSet('chapters:'+titleId, JSON.stringify(chapters));
  }
  async function getChapterContent(titleId, chapterId){
    const raw = await storeGet('content:'+titleId+':'+chapterId);
    return raw || '';
  }
  async function saveChapterContent(titleId, chapterId, text){
    return storeSet('content:'+titleId+':'+chapterId, text);
  }
  async function getProgress(titleId){
    const raw = await storeGet('progress:'+titleId);
    if(!raw) return null;
    try{ return JSON.parse(raw); }catch(e){ return null; }
  }
  async function saveProgress(titleId, progress){
    return storeSet('progress:'+titleId, JSON.stringify(progress));
  }
  async function getReaderSettings(){
    const raw = await storeGet('reader-settings');
    if(!raw) return { fontSize:19 };
    try{ return JSON.parse(raw); }catch(e){ return { fontSize:19 }; }
  }
  async function saveReaderSettings(s){
    return storeSet('reader-settings', JSON.stringify(s));
  }

  /* ============ UTIL ============ */
  function uid(){ return Date.now().toString(36)+Math.random().toString(36).slice(2,9); }
  function escapeHtml(str){
    return String(str==null?'':str)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }
  function clothFor(str){
    let h=0;
    for(let i=0;i<str.length;i++){ h = (h*31 + str.charCodeAt(i)) >>> 0; }
    return CLOTHS[h % CLOTHS.length];
  }
  function formatDate(ts){
    if(!ts) return '';
    const d = new Date(ts);
    return d.toLocaleDateString('ru-RU', { day:'2-digit', month:'short', year:'numeric' });
  }
  function debounce(fn, ms){
    let t; return function(...args){ clearTimeout(t); t = setTimeout(()=>fn.apply(this,args), ms); };
  }
  function showToast(msg, type){
    const el = document.createElement('div');
    el.className = 'toast' + (type==='error' ? ' error' : '');
    el.textContent = msg;
    toastRoot.appendChild(el);
    setTimeout(()=>{ el.style.opacity='0'; el.style.transition='opacity .3s'; setTimeout(()=>el.remove(), 320); }, 2400);
  }

  /* ============ COVER RENDER ============ */
  function renderCover(t){
    const cloth = clothFor(t.id + t.title);
    const monogram = (t.title||'?').trim().charAt(0).toUpperCase() || '?';
    const imgPart = t.coverUrl ? `<img class="book-cover-img" src="${escapeHtml(t.coverUrl)}" alt="" loading="lazy" onerror="this.style.display='none'">` : '';
    return `
      <div class="book-cover" style="background:${cloth.bg}">
        <div class="book-cover-fallback">
          <span class="book-cover-monogram">${escapeHtml(monogram)}</span>
          <span class="book-cover-title">${escapeHtml(t.title)}</span>
        </div>
        ${imgPart}
      </div>`;
  }

  /* ============ ATMOSPHERE BACKGROUND ============ */
  const atmosphereEl = document.getElementById('atmosphereLayer');
  function safeBgUrl(url){
    if(!url) return '';
    try{
      const u = new URL(url, location.href);
      if(u.protocol==='http:' || u.protocol==='https:' || u.protocol==='data:') return u.href;
    }catch(e){}
    return '';
  }
  function setAtmosphere(url){
    const safe = safeBgUrl(url);
    if(safe){
      atmosphereEl.style.backgroundImage = `url("${safe.replace(/"/g,'%22')}")`;
      atmosphereEl.classList.add('is-active');
    } else {
      atmosphereEl.classList.remove('is-active');
    }
  }
  function syncAtmosphere(){
    if((state.view==='detail' || state.view==='reader') && state.currentTitleId){
      const t = state.titles.find(x=>x.id===state.currentTitleId);
      setAtmosphere(t ? t.backgroundUrl : '');
    } else {
      setAtmosphere('');
    }
  }

  /* ============ ROUTING ============ */
  function goLibrary(){
    viewRevision++;
    teardownReaderScroll();
    state.view='library'; state.currentTitleId=null; state.currentChapterId=null;
    render();
  }
  async function goDetail(titleId){
    const requestRevision = ++viewRevision;
    teardownReaderScroll();
    state.view='detail'; state.currentTitleId=titleId; state.loading=true;
    render();
    const chapters = await getChapters(titleId);
    if(requestRevision!==viewRevision || state.view!=='detail' || state.currentTitleId!==titleId) return;
    state.chapters = chapters;
    state.loading=false;
    render();
  }
  async function goReader(titleId, chapterId, opts){
    opts = opts || {};
    const requestRevision = ++viewRevision;
    teardownReaderScroll();
    state.view='reader'; state.currentTitleId=titleId; state.currentChapterId=chapterId; state.loading=true;
    render();
    const [chapters, settings] = await Promise.all([
      getChapters(titleId),
      getReaderSettings()
    ]);
    if(requestRevision!==viewRevision || state.view!=='reader' || state.currentTitleId!==titleId || state.currentChapterId!==chapterId) return;
    state.chapters = chapters;
    state.readerSettings = settings;
    state.readerRestoreRatio = opts.restoreRatio || 0;
    state.loading=false;
    render();
    setupReaderScroll();
    // mark progress
    saveProgress(titleId, { chapterId, scrollRatio: opts.restoreRatio || 0 });
  }

  /* ============ RENDER DISPATCH ============ */
  function render(){
    syncAtmosphere();
    if(state.view==='library') return renderLibrary();
    if(state.view==='detail') return renderDetail();
    if(state.view==='reader') return renderReader();
  }

  /* ============ LIBRARY VIEW ============ */
  function renderLibrary(){
    document.getElementById('searchBoxWrap').style.display = '';
    if(state.loading){
      mainEl.innerHTML = `
        <div class="library-wrap">
          <div class="shelf-heading"><h1>Полка</h1></div>
          <p class="shelf-tagline">Загрузка…</p>
          <div class="skeleton-grid">
            ${Array(6).fill('<div class="skeleton-card"></div>').join('')}
          </div>
        </div>`;
      return;
    }
    const q = state.searchQuery.trim().toLowerCase();
    const filtered = !q ? state.titles : state.titles.filter(t=>{
      const hay = [t.title, t.author, (t.tags||[]).join(' ')].join(' ').toLowerCase();
      return hay.includes(q);
    });

    if(state.titles.length===0){
      mainEl.innerHTML = `
        <div class="library-wrap">
          <div class="empty-state">
            <span class="eyebrow">Полка пуста</span>
            <h2>Начните свою коллекцию</h2>
            <p>Добавьте первое произведение — новеллу, ранобэ или книгу — и оно появится здесь на полке вместе с обложкой и списком глав.</p>
            <button class="btn btn-primary" data-action="open-add-title">+ Добавить произведение</button>
          </div>
        </div>`;
      return;
    }

    if(filtered.length===0){
      mainEl.innerHTML = `
        <div class="library-wrap">
          <div class="shelf-heading"><h1>Полка</h1><span class="shelf-count">${state.titles.length}</span></div>
          <p class="shelf-tagline">По запросу «${escapeHtml(state.searchQuery)}» ничего не найдено.</p>
        </div>`;
      return;
    }

    mainEl.innerHTML = `
      <div class="library-wrap">
        <div class="shelf-kicker">Ваша коллекция</div>
        <div class="shelf-heading"><h1>Полка</h1><span class="shelf-count">${state.titles.length}</span></div>
        <p class="shelf-tagline">Личная библиотека новелл, ранобэ и книг.</p>
        <div class="shelf-grid">
          ${filtered.map((t,i)=>`
            <div class="book-card" style="--tilt:${((i%5)-2)*0.6}deg;--enter-delay:${Math.min(i,8)*55}ms" tabindex="0" role="button"
                 data-action="open-title" data-id="${t.id}" aria-label="${escapeHtml(t.title)}">
              ${renderCover(t)}
              <div class="book-card-meta">
                <div class="book-card-title">${escapeHtml(t.title)}</div>
                ${t.author ? `<div class="book-card-author">${escapeHtml(t.author)}</div>` : ''}
              </div>
            </div>
          `).join('')}
        </div>
      </div>`;
  }

  /* ============ DETAIL VIEW ============ */
  function renderDetail(){
    document.getElementById('searchBoxWrap').style.display = 'none';
    const t = state.titles.find(x=>x.id===state.currentTitleId);
    if(!t){ goLibrary(); return; }

    if(state.loading){
      mainEl.innerHTML = `<div class="detail-wrap"><p class="shelf-tagline">Загрузка…</p></div>`;
      return;
    }

    const chapters = state.chapters;
    getProgress(t.id).then(progress=>{
      if(state.view!=='detail' || state.currentTitleId!==t.id) return;
      const btn = document.getElementById('continueBtn');
      if(!btn) return;
      if(progress && chapters.find(c=>c.id===progress.chapterId)){
        const idx = chapters.findIndex(c=>c.id===progress.chapterId);
        btn.textContent = 'Продолжить · Глава ' + (idx+1);
        btn.dataset.chapterId = progress.chapterId;
        btn.dataset.ratio = progress.scrollRatio || 0;
      }
    });

    mainEl.innerHTML = `
      <div class="detail-wrap">
        <a class="back-link" data-action="go-library" href="#">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>
          На полку
        </a>
        <div class="detail-kicker">Карточка произведения</div>
        <div class="catalog-card">
          <div class="catalog-cover-col">${renderCover(t)}</div>
          <div class="catalog-info">
            <h1>${escapeHtml(t.title)}</h1>
            ${t.author ? `<div class="catalog-author">${escapeHtml(t.author)}</div>` : ''}
            ${(t.tags&&t.tags.length) ? `<div class="tag-row">${t.tags.map(tag=>`<span class="tag-chip">${escapeHtml(tag)}</span>`).join('')}</div>` : ''}
            ${t.description ? `<div class="catalog-desc">${escapeHtml(t.description)}</div>` : `<div class="catalog-desc" style="opacity:.6">Описание пока не добавлено.</div>`}
            <div class="catalog-actions">
              <button class="btn btn-primary" id="continueBtn" data-action="start-reading" data-id="${t.id}"
                ${chapters.length===0 ? 'disabled' : ''}>${chapters.length===0 ? 'Нет глав' : 'Читать · Глава 1'}</button>
              <button class="btn" data-action="open-edit-title" data-id="${t.id}">Изменить</button>
            </div>
            <div class="catalog-stats">
              <span><b>${chapters.length}</b> ${chapterWord(chapters.length)}</span>
              <span>добавлено <b>${formatDate(t.createdAt)}</b></span>
            </div>
          </div>
        </div>

        <div class="chapters-section">
          <div class="chapters-head">
            <h2>Главы</h2>
            <button class="btn btn-sm" data-action="open-add-chapter" data-id="${t.id}">+ Добавить главу</button>
          </div>
          <div class="chapters-list">
            ${chapters.length===0 ? `
              <div class="chapters-empty">Глав пока нет. Добавьте первую, чтобы начать чтение.</div>
            ` : chapters.map((c,i)=>`
              <div class="chapter-row" style="--enter-delay:${250+Math.min(i,8)*38}ms">
                <span class="chapter-index">${String(i+1).padStart(3,'0')}</span>
                <div class="chapter-main" data-action="open-reader" data-id="${t.id}" data-chapter="${c.id}" tabindex="0" role="button" aria-label="Открыть: ${escapeHtml(c.title)}">
                  <div class="chapter-title">${escapeHtml(c.title)}</div>
                  <div class="chapter-sub">${formatDate(c.createdAt)}</div>
                </div>
                <div class="chapter-actions">
                  <button class="btn-icon" title="Выше" data-action="chapter-up" data-id="${t.id}" data-chapter="${c.id}" ${i===0?'disabled':''}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M5 15l7-7 7 7"/></svg>
                  </button>
                  <button class="btn-icon" title="Ниже" data-action="chapter-down" data-id="${t.id}" data-chapter="${c.id}" ${i===chapters.length-1?'disabled':''}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M5 9l7 7 7-7"/></svg>
                  </button>
                  <button class="btn-icon" title="Изменить" data-action="open-edit-chapter" data-id="${t.id}" data-chapter="${c.id}">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>
                  </button>
                </div>
              </div>
            `).join('')}
          </div>
        </div>

        <div class="catalog-manage">
          <button class="btn btn-danger btn-sm" data-action="delete-title" data-id="${t.id}">Удалить произведение</button>
        </div>
      </div>`;
  }
  function chapterWord(n){
    const mod10 = n%10, mod100 = n%100;
    if(mod10===1 && mod100!==11) return 'глава';
    if([2,3,4].includes(mod10) && ![12,13,14].includes(mod100)) return 'главы';
    return 'глав';
  }

  /* ============ READER VIEW ============ */
  function teardownReaderScroll(){
    if(scrollHandlerRef){ window.removeEventListener('scroll', scrollHandlerRef); scrollHandlerRef=null; }
  }

  function setupReaderScroll(){
    const scrollEl = document.getElementById('readerScrollArea');
    const ribbon = document.getElementById('bookmarkRibbon');
    if(!scrollEl) return;
    teardownReaderScroll();
    const titleId = state.currentTitleId;
    const chapterId = state.currentChapterId;

    const debouncedSave = debounce(function(ratio){
      saveProgress(titleId, { chapterId, scrollRatio: ratio });
    }, 700);

    function onScroll(){
      const doc = document.documentElement;
      const scrollTop = window.scrollY || doc.scrollTop;
      const max = (doc.scrollHeight - window.innerHeight);
      const ratio = max>0 ? Math.min(1, Math.max(0, scrollTop/max)) : 0;
      if(ribbon) ribbon.style.height = (ratio*100)+'%';
      debouncedSave(ratio);
    }
    scrollHandlerRef = onScroll;
    window.addEventListener('scroll', onScroll, { passive:true });
    onScroll();
  }

  function restoreReaderScroll(restoreRatio){
    requestAnimationFrame(()=>{
      if(state.view!=='reader') return;
      const doc = document.documentElement;
      const max = doc.scrollHeight - window.innerHeight;
      window.scrollTo(0, restoreRatio>0 ? max*restoreRatio : 0);
      window.dispatchEvent(new Event('scroll'));
    });
  }

  function renderReader(){
    document.getElementById('searchBoxWrap').style.display = 'none';
    const t = state.titles.find(x=>x.id===state.currentTitleId);
    if(!t){ goLibrary(); return; }

    if(state.loading){
      mainEl.innerHTML = `<div class="reader-body"><p class="shelf-tagline" style="padding-top:24px">Загрузка главы…</p></div>`;
      return;
    }

    const chapters = state.chapters;
    const idx = chapters.findIndex(c=>c.id===state.currentChapterId);
    const chapter = chapters[idx];
    if(!chapter){
      mainEl.innerHTML = `<div class="reader-body"><div class="reader-empty">Глава не найдена.</div></div>`;
      return;
    }
    const prev = chapters[idx-1];
    const next = chapters[idx+1];
    const fontSize = state.readerSettings.fontSize || 19;

    const contentPromise = getChapterContent(t.id, chapter.id);

    mainEl.innerHTML = `
      <div class="reader-topbar">
        <button class="btn-icon" data-action="go-detail" title="К произведению">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
        <div class="r-title">
          <div class="r-book">${escapeHtml(t.title)}</div>
          <div class="r-chap">${escapeHtml(chapter.title)}</div>
        </div>
        <div class="reader-controls">
          <select class="btn btn-sm" id="chapterJump" aria-label="Перейти к главе" style="max-width:150px">
            ${chapters.map((c,i)=>`<option value="${c.id}" ${c.id===chapter.id?'selected':''}>${i+1}. ${escapeHtml(c.title).slice(0,30)}</option>`).join('')}
          </select>
          <div class="font-size-group">
            <button data-action="font-smaller" title="Меньше шрифт">A-</button>
            <span></span>
            <button data-action="font-bigger" title="Крупнее шрифт">A+</button>
          </div>
        </div>
      </div>

      <div class="bookmark-ribbon-track"><div class="bookmark-ribbon" id="bookmarkRibbon" style="height:0%"></div></div>

      <div id="readerScrollArea" class="reader-body">
        <div class="reader-page" style="font-size:${fontSize}px">
          <span class="r-eyebrow">Глава ${idx+1} из ${chapters.length}</span>
          <h2>${escapeHtml(chapter.title)}</h2>
          <div class="reader-rule"></div>
          <div class="reader-content" id="readerContent"><p style="opacity:.5">Загрузка текста…</p></div>
        </div>
      </div>

      <div class="reader-bottom-nav">
        <button class="btn" data-action="prev-chapter" ${!prev?'disabled':''}>‹ Пред. глава</button>
        <button class="btn" data-action="next-chapter" ${!next?'disabled':''}>След. глава ›</button>
      </div>
    `;

    contentPromise.then(text=>{
      if(state.view!=='reader' || state.currentTitleId!==t.id || state.currentChapterId!==chapter.id) return;
      const el = document.getElementById('readerContent');
      if(!el) return;
      if(!text || !text.trim()){
        el.innerHTML = '<p style="opacity:.55">Текст этой главы пока пуст.</p>';
      } else {
        const paras = text.split(/\n{2,}/).map(p=>p.trim()).filter(Boolean);
        el.innerHTML = paras.map(p=>'<p>'+escapeHtml(p).replace(/\n/g,'<br>')+'</p>').join('');
      }
      restoreReaderScroll(state.readerRestoreRatio);
    });

    document.getElementById('chapterJump').addEventListener('change', function(e){
      goReader(t.id, e.target.value);
    });
  }

  /* ============ MODALS: ADD/EDIT TITLE ============ */
  function openTitleModal(existing){
    const isEdit = !!existing;
    modalRoot.innerHTML = `
      <div class="modal-backdrop" data-action="close-modal">
        <div class="modal" role="dialog" aria-modal="true" onclick="event.stopPropagation()">
          <div class="modal-head">
            <h2>${isEdit ? 'Изменить произведение' : 'Новое произведение'}</h2>
            <button class="btn-icon" data-action="close-modal" aria-label="Закрыть">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          </div>
          <form id="titleForm">
            <div class="form-field">
              <label for="f-title">Название*</label>
              <input type="text" id="f-title" required maxlength="180" value="${existing?escapeHtml(existing.title):''}">
            </div>
            <div class="form-row">
              <div class="form-field">
                <label for="f-author">Автор</label>
                <input type="text" id="f-author" maxlength="120" value="${existing?escapeHtml(existing.author||''):''}">
              </div>
              <div class="form-field">
                <label for="f-tags">Жанры / теги</label>
                <input type="text" id="f-tags" placeholder="фэнтези, драма" value="${existing?escapeHtml((existing.tags||[]).join(', ')):''}">
              </div>
            </div>
            <div class="form-field">
              <label for="f-cover">Обложка — ссылка на изображение (необязательно)</label>
              <input type="url" id="f-cover" placeholder="https://…" value="${existing?escapeHtml(existing.coverUrl||''):''}">
              <div class="hint">Если не указать, обложка будет сгенерирована автоматически.</div>
            </div>
            <div class="form-field">
              <label for="f-bg">Атмосферный фон — ссылка на изображение (необязательно)</label>
              <input type="url" id="f-bg" placeholder="https://…" value="${existing?escapeHtml(existing.backgroundUrl||''):''}">
              <div class="hint">Показывается приглушённым фоном на странице произведения и при чтении. Оставьте пустым, чтобы убрать.</div>
            </div>
            <div class="form-field">
              <label for="f-desc">Описание</label>
              <textarea id="f-desc" rows="4" maxlength="2000">${existing?escapeHtml(existing.description||''):''}</textarea>
            </div>
            <div class="modal-actions">
              ${isEdit ? `<button type="button" class="btn btn-danger" data-action="delete-title" data-id="${existing.id}">Удалить</button>` : '<span></span>'}
              <div class="modal-actions-right">
                <button type="button" class="btn btn-ghost" data-action="close-modal">Отмена</button>
                <button type="submit" class="btn btn-primary">Сохранить</button>
              </div>
            </div>
          </form>
        </div>
      </div>`;
    document.getElementById('f-title').focus();
    document.getElementById('titleForm').addEventListener('submit', function(e){
      e.preventDefault();
      submitTitleForm(existing);
    });
  }

  async function submitTitleForm(existing){
    const title = document.getElementById('f-title').value.trim();
    if(!title){ showToast('Укажите название', 'error'); return; }
    const author = document.getElementById('f-author').value.trim();
    const tagsRaw = document.getElementById('f-tags').value.trim();
    const tags = tagsRaw ? tagsRaw.split(',').map(s=>s.trim()).filter(Boolean) : [];
    const coverUrl = document.getElementById('f-cover').value.trim();
    const backgroundUrl = document.getElementById('f-bg').value.trim();
    const description = document.getElementById('f-desc').value.trim();

    if(existing){
      const updated = { ...existing, title, author, tags, coverUrl, backgroundUrl, description };
      const nextTitles = state.titles.map(t=>t.id===existing.id ? updated : t);
      const ok = await saveTitles(nextTitles);
      if(!ok){ showToast('Ошибка сохранения. Попробуйте снова.', 'error'); return; }
      state.titles = nextTitles;
      showToast('Сохранено');
      closeModal();
      render();
    } else {
      const t = { id: uid(), title, author, tags, coverUrl, backgroundUrl, description, createdAt: Date.now(), chapterCount:0 };
      const nextTitles = [t, ...state.titles];
      const ok = await saveTitles(nextTitles);
      if(!ok){ showToast('Ошибка сохранения. Попробуйте снова.', 'error'); return; }
      state.titles = nextTitles;
      showToast('Произведение добавлено');
      closeModal();
      goDetail(t.id);
    }
  }

  /* ============ MODALS: ADD/EDIT CHAPTER ============ */
  async function openChapterModal(titleId, existingChapterId){
    let existingChapter = null;
    let existingContent = '';
    if(existingChapterId){
      existingChapter = state.chapters.find(c=>c.id===existingChapterId);
      existingContent = await getChapterContent(titleId, existingChapterId);
    }
    const isEdit = !!existingChapter;
    modalRoot.innerHTML = `
      <div class="modal-backdrop" data-action="close-modal">
        <div class="modal modal-wide" role="dialog" aria-modal="true" onclick="event.stopPropagation()">
          <div class="modal-head">
            <h2>${isEdit ? 'Изменить главу' : 'Новая глава'}</h2>
            <button class="btn-icon" data-action="close-modal" aria-label="Закрыть">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          </div>
          <form id="chapterForm">
            <div class="form-field">
              <label for="c-title">Название главы*</label>
              <input type="text" id="c-title" required maxlength="200" value="${existingChapter?escapeHtml(existingChapter.title):''}">
            </div>
            <div class="form-field">
              <label for="c-content">Текст главы*</label>
              <textarea id="c-content" rows="14" required placeholder="Вставьте текст главы. Пустая строка между абзацами.">${escapeHtml(existingContent)}</textarea>
            </div>
            <div class="modal-actions">
              ${isEdit ? `<button type="button" class="btn btn-danger" data-action="delete-chapter" data-id="${titleId}" data-chapter="${existingChapter.id}">Удалить главу</button>` : '<span></span>'}
              <div class="modal-actions-right">
                <button type="button" class="btn btn-ghost" data-action="close-modal">Отмена</button>
                <button type="submit" class="btn btn-primary">Сохранить главу</button>
              </div>
            </div>
          </form>
        </div>
      </div>`;
    document.getElementById('c-title').focus();
    document.getElementById('chapterForm').addEventListener('submit', function(e){
      e.preventDefault();
      submitChapterForm(titleId, existingChapter);
    });
  }

  async function submitChapterForm(titleId, existingChapter){
    const title = document.getElementById('c-title').value.trim();
    const content = document.getElementById('c-content').value;
    if(!title || !content.trim()){ showToast('Заполните название и текст главы', 'error'); return; }

    if(existingChapter){
      const updatedChapter = { ...existingChapter, title };
      const nextChapters = state.chapters.map(c=>c.id===existingChapter.id ? updatedChapter : c);
      const ok1 = await saveChapters(titleId, nextChapters);
      const ok2 = await saveChapterContent(titleId, existingChapter.id, content);
      if(!ok1 || !ok2){ showToast('Ошибка сохранения. Попробуйте снова.', 'error'); return; }
      state.chapters = nextChapters;
      showToast('Глава сохранена');
    } else {
      const c = { id: uid(), title, createdAt: Date.now() };
      const nextChapters = [...state.chapters, c];
      const ok1 = await saveChapters(titleId, nextChapters);
      const ok2 = await saveChapterContent(titleId, c.id, content);
      if(!ok1 || !ok2){ showToast('Ошибка сохранения. Попробуйте снова.', 'error'); return; }
      state.chapters = nextChapters;
      await updateChapterCount(titleId, state.chapters.length);
      showToast('Глава добавлена');
    }
    closeModal();
    render();
  }

  async function updateChapterCount(titleId, count){
    const t = state.titles.find(x=>x.id===titleId);
    if(t){ t.chapterCount = count; await saveTitles(state.titles); }
  }

  function closeModal(){ modalRoot.innerHTML=''; }

  /* ============ DELETE OPS ============ */
  async function deleteTitleFlow(titleId){
    const t = state.titles.find(x=>x.id===titleId);
    if(!t) return;
    if(!confirm('Удалить «'+t.title+'» и все главы безвозвратно?')) return;
    const chapters = await getChapters(titleId);
    for(const c of chapters){ await storeDelete('content:'+titleId+':'+c.id); }
    await storeDelete('chapters:'+titleId);
    await storeDelete('progress:'+titleId);
    state.titles = state.titles.filter(x=>x.id!==titleId);
    await saveTitles(state.titles);
    showToast('Произведение удалено');
    closeModal();
    goLibrary();
  }

  async function deleteChapterFlow(titleId, chapterId){
    const c = state.chapters.find(x=>x.id===chapterId);
    if(!c) return;
    if(!confirm('Удалить главу «'+c.title+'»?')) return;
    state.chapters = state.chapters.filter(x=>x.id!==chapterId);
    await saveChapters(titleId, state.chapters);
    await storeDelete('content:'+titleId+':'+chapterId);
    await updateChapterCount(titleId, state.chapters.length);
    showToast('Глава удалена');
    closeModal();
    render();
  }

  async function moveChapter(titleId, chapterId, dir){
    const arr = state.chapters;
    const i = arr.findIndex(c=>c.id===chapterId);
    const j = i+dir;
    if(i<0 || j<0 || j>=arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    await saveChapters(titleId, arr);
    render();
  }

  /* ============ EVENT DELEGATION ============ */
  document.body.addEventListener('click', function(e){
    const el = e.target.closest('[data-action]');
    if(!el) return;
    const action = el.dataset.action;
    if(action==='go-library' && el.tagName==='A') e.preventDefault();
    const id = el.dataset.id;
    const chapterId = el.dataset.chapter;

    switch(action){
      case 'go-library': goLibrary(); break;
      case 'go-detail': goDetail(state.currentTitleId); break;
      case 'open-title': goDetail(id); break;
      case 'open-reader': goReader(id, chapterId); break;
      case 'start-reading': {
        const restoreId = el.dataset.chapterId;
        const ratio = parseFloat(el.dataset.ratio || '0');
        if(restoreId){ goReader(id, restoreId, { restoreRatio: ratio }); }
        else if(state.chapters[0]){ goReader(id, state.chapters[0].id); }
        break;
      }
      case 'open-add-title': openTitleModal(null); break;
      case 'open-edit-title': {
        const t = state.titles.find(x=>x.id===id);
        openTitleModal(t);
        break;
      }
      case 'delete-title': deleteTitleFlow(id); break;
      case 'open-add-chapter': openChapterModal(id, null); break;
      case 'open-edit-chapter': openChapterModal(id, chapterId); break;
      case 'delete-chapter': deleteChapterFlow(id, chapterId); break;
      case 'chapter-up': moveChapter(id, chapterId, -1); break;
      case 'chapter-down': moveChapter(id, chapterId, 1); break;
      case 'close-modal': closeModal(); break;
      case 'prev-chapter': {
        const idx = state.chapters.findIndex(c=>c.id===state.currentChapterId);
        if(idx>0) goReader(state.currentTitleId, state.chapters[idx-1].id);
        break;
      }
      case 'next-chapter': {
        const idx = state.chapters.findIndex(c=>c.id===state.currentChapterId);
        if(idx<state.chapters.length-1) goReader(state.currentTitleId, state.chapters[idx+1].id);
        break;
      }
      case 'font-smaller': changeFontSize(-1); break;
      case 'font-bigger': changeFontSize(1); break;
    }
  });

  document.body.addEventListener('keydown', function(e){
    if(e.key!=='Enter' && e.key!==' ') return;
    const el = e.target.closest('[data-action][role="button"]');
    if(!el) return;
    e.preventDefault();
    el.click();
  });

  document.addEventListener('keydown', function(e){
    if(e.key==='Escape') closeModal();
  });

  async function changeFontSize(delta){
    const s = state.readerSettings;
    s.fontSize = Math.min(28, Math.max(14, (s.fontSize||19)+delta));
    await saveReaderSettings(s);
    const page = document.querySelector('.reader-page');
    if(page) page.style.fontSize = s.fontSize+'px';
  }

  searchInput.addEventListener('input', debounce(function(){
    state.searchQuery = searchInput.value;
    if(state.view==='library') renderLibrary();
  }, 150));

  /* ============ INIT ============ */
  async function init(){
    state.loading = true;
    render();
    state.titles = await getTitles();
    state.readerSettings = await getReaderSettings();
    state.loading = false;
    render();
  }
  init();

})();
