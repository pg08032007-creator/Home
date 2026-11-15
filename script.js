/* =========================================================
   Navegador PK — script
   Navegador pessoal em página única: vídeo de fundo estável,
   busca rápida no Google/URL e favoritos salvos no aparelho.
   ========================================================= */
(function () {
    'use strict';

    var STORAGE_FAVS = 'browserFavs';
    var STORAGE_HISTORY = 'browserHistory';
    var LONG_PRESS_MS = 550;
    var DRAG_THRESHOLD = 10;
    var MAX_HISTORY = 8;
    var FALLBACK_ICON =
        'data:image/svg+xml;utf8,' +
        encodeURIComponent(
            '<svg xmlns="http://www.w3.org/2000/svg" width="50" height="50" viewBox="0 0 24 24" ' +
            'fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
            '<circle cx="12" cy="12" r="10"></circle>' +
            '<line x1="2" y1="12" x2="22" y2="12"></line>' +
            '<path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>' +
            '</svg>'
        );

    function $(id) { return document.getElementById(id); }

    function showToast(message, duration) {
        if (!toast) return;
        toast.textContent = message;
        toast.classList.add('visible');
        if (toastTimer) window.clearTimeout(toastTimer);
        toastTimer = window.setTimeout(function () {
            toast.classList.remove('visible');
        }, duration || 4000);
    }

    // ===== ELEMENTOS =====
    var video = $('bg-video');
    var searchInput = $('search-input');
    var suggestionsList = $('suggestions');
    var toggleFavsBtn = $('toggle-favs');
    var favoritesArea = $('favorites-area');
    var favoritesGrid = $('favorites-grid');
    var openModalBtn = $('open-modal-btn');
    var favModal = $('fav-modal');
    var cancelFavBtn = $('cancel-fav');
    var saveFavBtn = $('save-fav');
    var favUrlInput = $('fav-url');
    var favNameInput = $('fav-name');
    var uploadBtn = $('upload-btn');
    var favFileInput = $('fav-file');
    var previewContainer = $('preview-container');
    var previewImg = $('preview-img');
    var removePreviewBtn = $('remove-preview');
    var fullscreenBtn = $('fullscreen-btn');
    var fullscreenIcon = $('fullscreen-icon');
    var toast = $('toast');
    var toastTimer = null;
    var removeModal = $('remove-modal');
    var removeName = $('remove-modal-name');
    var removeCancelBtn = $('remove-cancel');
    var removeConfirmBtn = $('remove-confirm');

    if (!searchInput || !favoritesGrid) return;

    var currentIconBase64 = '';
    var pendingRemoveId = null;

    // =========================================================
    // 1. VÍDEO DE FUNDO — mantém tocando, sem "quebras"
    // =========================================================

    function initVideo() {
        if (!video) {
            document.body.classList.add('video-unavailable');
            return;
        }

        var failed = false;
        var lastRecovery = 0;
        var lastPlayAttempt = 0;

        function markFailed() {
            if (failed) return;
            failed = true;
            document.body.classList.add('video-unavailable');
            showToast('Vídeo de fundo não encontrado. Coloque o arquivo Fundo.mp4 na mesma pasta do index.html.', 6000);
        }

        function play() {
            if (failed) return;
            var now = Date.now();
            if (now - lastPlayAttempt < 1200) return;
            lastPlayAttempt = now;
            var promise = video.play();
            if (promise && typeof promise.catch === 'function') {
                promise.catch(function () { /* autoplay bloqueado pelo navegador */ });
            }
        }

        video.muted = true;
        video.loop = true;
        video.setAttribute('muted', '');
        video.setAttribute('playsinline', '');

        // Só o erro geral do vídeo conta como falha: um <source> que não existe
        // ainda pode ser seguido por outro que funcione.
        video.addEventListener('error', markFailed);

        // Se o arquivo não existir / não for suportado, usa o fundo reserva.
        window.setTimeout(function () {
            var noSource = video.networkState === 3; /* NETWORK_NO_SOURCE */
            if (noSource || video.error) markFailed();
        }, 4000);

        function recover() {
            if (failed || document.hidden) return;
            var now = Date.now();
            if (now - lastRecovery < 10000) return; // evita recarregar em loop
            lastRecovery = now;
            try {
                video.load();
                video.currentTime = 0;
            } catch (err) { /* ignora */ }
            play();
        }

        // Travou no meio da reprodução? Recarrega suavemente.
        video.addEventListener('stalled', function () {
            if (video.readyState < 2) recover();
        });
        video.addEventListener('waiting', function () {
            if (video.readyState < 2) window.setTimeout(function () {
                if (video.readyState < 2) recover();
            }, 6000);
        });

        // Loop: nunca para no fim.
        video.addEventListener('ended', function () {
            try { video.currentTime = 0; } catch (err) { /* ignora */ }
            play();
        });

        // Nunca fica pausado (a não ser que a aba esteja escondida).
        video.addEventListener('pause', function () {
            if (!document.hidden) play();
        });

        document.addEventListener('visibilitychange', function () {
            if (!document.hidden) play();
        });

        // Rede voltou / aparelho desbloqueado.
        window.addEventListener('online', recover);
        window.addEventListener('pageshow', play);

        // Vigia: se por algum motivo pausou, retoma.
        window.setInterval(function () {
            if (document.hidden || failed) return;
            if (video.paused) play();
        }, 5000);

        play();
    }

    // =========================================================
    // 2. TELA CHEIA
    // =========================================================

    function fullscreenElement() {
        return document.fullscreenElement || document.webkitFullscreenElement || null;
    }

    function attemptFullscreen() {
        var el = document.documentElement;
        var promise;

        try {
            if (el.requestFullscreen) {
                promise = el.requestFullscreen({ navigationUI: 'hide' });
            } else if (el.webkitRequestFullscreen) {
                el.webkitRequestFullscreen();
                return;
            } else {
                promise = Promise.reject(new Error('unsupported'));
            }
        } catch (err) {
            promise = Promise.reject(err);
        }

        if (promise && typeof promise.catch === 'function') {
            promise.catch(function () {
                showToast('Não foi possível entrar em tela cheia aqui. Abra o site direto no navegador (no iPhone: “Adicionar à Tela de Início”).', 5000);
            });
        }
    }

    function exitFullscreen() {
        try {
            if (document.exitFullscreen) return document.exitFullscreen();
            if (document.webkitExitFullscreen) { document.webkitExitFullscreen(); return Promise.resolve(); }
        } catch (err) { /* ignora */ }
        return Promise.resolve();
    }

    function toggleFullscreen() {
        if (fullscreenElement()) {
            exitFullscreen().catch(function () {});
        } else {
            attemptFullscreen();
        }
    }

    function updateFullscreenIcon() {
        var active = !!fullscreenElement();
        if (fullscreenIcon) {
            fullscreenIcon.className = active ? 'fa-solid fa-compress' : 'fa-solid fa-expand';
        }
        if (fullscreenBtn) {
            fullscreenBtn.setAttribute('aria-label', active ? 'Sair da tela cheia' : 'Entrar em tela cheia');
            fullscreenBtn.setAttribute('title', active ? 'Sair da tela cheia' : 'Tela cheia');
        }
    }

    function initFullscreen() {
        if (!fullscreenBtn) return;
        fullscreenBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            toggleFullscreen();
        });

        document.addEventListener('fullscreenchange', updateFullscreenIcon);
        document.addEventListener('webkitfullscreenchange', updateFullscreenIcon);
        updateFullscreenIcon();
    }

    // =========================================================
    // 3. PESQUISA RÁPIDA
    // =========================================================

    function googleUrl(term) {
        return 'https://www.google.com/search?q=' + encodeURIComponent(term);
    }

    // Decide se o texto é um endereço ou uma pesquisa no Google.
    function resolveTarget(raw) {
        var q = String(raw || '').trim();
        if (!q) return null;
        if (/^https?:\/\/\S+$/i.test(q)) return q;
        if (/\s/.test(q)) return googleUrl(q);

        var looksLikeUrl =
            /^[\w-]+(\.[\w-]+)+([\/?#].*)?$/.test(q) ||
            /^localhost(:\d+)?([\/?#].*)?$/i.test(q) ||
            /^\d{1,3}(\.\d{1,3}){3}(:\d+)?([\/?#].*)?$/.test(q);

        if (looksLikeUrl) return 'https://' + q;
        return googleUrl(q);
    }

    function historyList() {
        try {
            var data = JSON.parse(localStorage.getItem(STORAGE_HISTORY) || '[]');
            return Array.isArray(data) ? data.filter(function (t) { return typeof t === 'string' && t; }) : [];
        } catch (err) {
            return [];
        }
    }

    function rememberSearch(term) {
        if (!term) return;
        var list = historyList().filter(function (t) {
            return t.toLowerCase() !== term.toLowerCase();
        });
        list.unshift(term);
        try {
            localStorage.setItem(STORAGE_HISTORY, JSON.stringify(list.slice(0, MAX_HISTORY)));
        } catch (err) { /* armazenamento cheio: ignora */ }
    }

    function goTo(target) {
        if (!target) return;
        try {
            window.location.href = target;
        } catch (err) {
            window.open(target, '_blank', 'noopener');
        }
    }

    function submitSearch(raw) {
        var term = String(raw || '').trim();
        if (!term) { searchInput.focus(); return; }
        var target = resolveTarget(term);
        if (!target) return;
        rememberSearch(term);
        hideSuggestions();
        goTo(target);
    }

    // ----- sugestões (histórico + favoritos) -----

    var suggestionItems = [];
    var activeSuggestion = -1;

    function hideSuggestions() {
        suggestionItems = [];
        activeSuggestion = -1;
        if (!suggestionsList) return;
        suggestionsList.innerHTML = '';
        suggestionsList.classList.add('hidden');
        searchInput.setAttribute('aria-expanded', 'false');
    }

    function highlightSuggestion(index) {
        activeSuggestion = index;
        var nodes = suggestionsList ? suggestionsList.children : [];
        for (var i = 0; i < nodes.length; i++) {
            nodes[i].classList.toggle('active', i === index);
            nodes[i].setAttribute('aria-selected', i === index ? 'true' : 'false');
        }
        if (index >= 0 && nodes[index] && nodes[index].scrollIntoView) {
            nodes[index].scrollIntoView({ block: 'nearest' });
        }
    }

    function buildSuggestions(query) {
        var q = query.trim();
        var lower = q.toLowerCase();
        var results = [];
        var seen = {};

        function push(label, url, icon, kind, favIcon) {
            var key = kind + '|' + label.toLowerCase();
            if (seen[key]) return;
            seen[key] = true;
            results.push({ label: label, url: url, icon: icon, kind: kind, favIcon: favIcon || '' });
        }

        if (q) {
            push(q, googleUrl(q), 'fa-magnifying-glass', 'search');
        }

        favorites.forEach(function (fav) {
            if (!q) return;
            if (fav.name.toLowerCase().indexOf(lower) === -1 && fav.url.toLowerCase().indexOf(lower) === -1) return;
            if (results.length >= 7) return;
            push(fav.name, fav.url, null, 'fav', iconFor(fav));
        });

        historyList().forEach(function (term) {
            if (q && term.toLowerCase().indexOf(lower) === -1) return;
            if (results.length >= 8) return;
            push(term, googleUrl(term), 'fa-clock-rotate-left', 'history');
        });

        favorites.slice(0, 4).forEach(function (fav) {
            if (!q) push(fav.name, fav.url, null, 'fav', iconFor(fav));
        });

        return results.slice(0, 8);
    }

    function renderSuggestions(query) {
        if (!suggestionsList) return;
        suggestionItems = buildSuggestions(query);
        activeSuggestion = -1;
        suggestionsList.innerHTML = '';

        if (!suggestionItems.length) {
            hideSuggestions();
            return;
        }

        suggestionItems.forEach(function (item, index) {
            var li = document.createElement('li');
            li.className = 'suggestion-item';
            li.setAttribute('role', 'option');
            li.setAttribute('aria-selected', 'false');
            li.dataset.index = String(index);

            var icon = document.createElement('span');
            icon.className = 'suggestion-icon';
            if (item.icon) {
                var glyph = document.createElement('i');
                glyph.className = 'fa-solid ' + item.icon;
                glyph.setAttribute('aria-hidden', 'true');
                icon.appendChild(glyph);
            } else {
                var img = document.createElement('img');
                img.src = item.favIcon || FALLBACK_ICON;
                img.alt = '';
                img.addEventListener('error', function onSuggestionIconError() {
                    img.removeEventListener('error', onSuggestionIconError);
                    img.src = FALLBACK_ICON;
                });
                icon.appendChild(img);
            }

            var label = document.createElement('span');
            label.className = 'suggestion-label';
            label.textContent = item.label;

            var kind = document.createElement('span');
            kind.className = 'suggestion-kind';
            kind.textContent = item.kind === 'search' ? 'Google' : (item.kind === 'fav' ? 'Favorito' : 'Recente');

            li.appendChild(icon);
            li.appendChild(label);
            li.appendChild(kind);

            // pointerdown evita perder o clique pelo blur do input.
            li.addEventListener('pointerdown', function (e) {
                e.preventDefault();
                if (item.kind === 'fav') {
                    hideSuggestions();
                    goTo(item.url);
                } else {
                    submitSearch(item.label);
                }
            });

            suggestionsList.appendChild(li);
        });

        suggestionsList.classList.remove('hidden');
        searchInput.setAttribute('aria-expanded', 'true');
    }

    function initSearch() {
        searchInput.addEventListener('input', function () {
            renderSuggestions(searchInput.value);
        });

        searchInput.addEventListener('focus', function () {
            if (searchInput.value.trim()) renderSuggestions(searchInput.value);
        });

        searchInput.addEventListener('keydown', function (e) {
            var count = suggestionItems.length;

            if (e.key === 'ArrowDown' && count) {
                e.preventDefault();
                highlightSuggestion((activeSuggestion + 1) % count);
                return;
            }
            if (e.key === 'ArrowUp' && count) {
                e.preventDefault();
                highlightSuggestion((activeSuggestion - 1 + count) % count);
                return;
            }
            if (e.key === 'Escape') {
                if (count) { hideSuggestions(); e.stopPropagation(); }
                return;
            }
            if (e.key === 'Enter') {
                e.preventDefault();
                if (activeSuggestion >= 0 && suggestionItems[activeSuggestion]) {
                    var chosen = suggestionItems[activeSuggestion];
                    if (chosen.kind === 'fav') {
                        hideSuggestions();
                        goTo(chosen.url);
                    } else {
                        submitSearch(chosen.label);
                    }
                    return;
                }
                submitSearch(searchInput.value);
            }
        });

        searchInput.addEventListener('blur', function () {
            window.setTimeout(hideSuggestions, 120);
        });

        // Atalho: "/" foca a barra de busca.
        document.addEventListener('keydown', function (e) {
            if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
            if (document.activeElement === searchInput) return;
            if (e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
            e.preventDefault();
            searchInput.focus();
            searchInput.select();
        });
    }

    // =========================================================
    // 4. FAVORITOS
    // =========================================================

    function hostnameOf(url) {
        try {
            return new URL(url).hostname.replace(/^www\./, '');
        } catch (err) {
            return url;
        }
    }

    function normalizeUrl(raw) {
        var value = String(raw || '').trim();
        if (!value) return null;
        if (!/^https?:\/\//i.test(value)) {
            if (!/^[\w-]+(\.[\w-]+)+([\/?#].*)?$/.test(value) &&
                !/^localhost(:\d+)?([\/?#].*)?$/i.test(value)) {
                return null;
            }
            value = 'https://' + value;
        }
        try {
            var parsed = new URL(value);
            if (!parsed.hostname || parsed.hostname.indexOf('.') === -1 && parsed.hostname !== 'localhost') {
                return null;
            }
            return parsed.href;
        } catch (err) {
            return null;
        }
    }

    function loadFavorites() {
        try {
            var raw = localStorage.getItem(STORAGE_FAVS);
            if (!raw) return [];
            var data = JSON.parse(raw);
            if (!Array.isArray(data)) return [];
            return data
                .filter(function (fav) {
                    return fav && typeof fav.url === 'string' && fav.url;
                })
                .map(function (fav) {
                    return {
                        id: typeof fav.id === 'string' && fav.id ? fav.id : 'fav-' + Math.random().toString(36).slice(2),
                        name: (typeof fav.name === 'string' && fav.name.trim()) ? fav.name.trim() : hostnameOf(fav.url),
                        url: fav.url,
                        icon: typeof fav.icon === 'string' ? fav.icon : ''
                    };
                });
        } catch (err) {
            return [];
        }
    }

    var favorites = loadFavorites();

    function persistFavorites() {
        try {
            localStorage.setItem(STORAGE_FAVS, JSON.stringify(favorites));
            return true;
        } catch (err) {
            alert('Não foi possível salvar: o armazenamento do navegador está cheio.');
            return false;
        }
    }

    function iconFor(fav) {
        if (fav.icon) return fav.icon;
        return 'https://www.google.com/s2/favicons?sz=128&domain=' + encodeURIComponent(hostnameOf(fav.url));
    }

    function renderFavorites() {
        favoritesGrid.innerHTML = '';

        if (!favorites.length) {
            var empty = document.createElement('p');
            empty.className = 'empty-favorites';
            empty.textContent = 'Nenhum favorito ainda.';
            favoritesGrid.appendChild(empty);
            return;
        }

        favorites.forEach(function (fav, index) {
            var item = document.createElement('div');
            item.className = 'fav-item';
            item.dataset.id = fav.id;
            item.tabIndex = 0;
            item.style.animationDelay = (index * 0.04) + 's';

            var link = document.createElement('a');
            link.href = fav.url;
            link.className = 'fav-link';
            link.draggable = false;
            link.setAttribute('aria-label', 'Abrir ' + fav.name);

            var iconWrapper = document.createElement('div');
            iconWrapper.className = 'fav-icon-wrapper';

            var img = document.createElement('img');
            img.alt = fav.name;
            img.draggable = false;
            img.loading = 'lazy';
            img.decoding = 'async';
            img.addEventListener('error', function onIconError() {
                img.removeEventListener('error', onIconError);
                img.src = FALLBACK_ICON;
                img.classList.add('is-fallback');
            });
            img.src = iconFor(fav);

            var label = document.createElement('span');
            label.textContent = fav.name;

            iconWrapper.appendChild(img);
            link.appendChild(iconWrapper);
            link.appendChild(label);
            item.appendChild(link);
            favoritesGrid.appendChild(item);

            attachItemEvents(item, fav, link);
        });
    }

    // ----- remoção (sem o "x": segure o favorito) -----

    function askRemove(fav) {
        if (!removeModal) return;
        pendingRemoveId = fav.id;
        if (removeName) removeName.textContent = '“' + fav.name + '” sairá da sua lista de favoritos.';
        removeModal.classList.remove('hidden');
        if (removeCancelBtn) removeCancelBtn.focus();
    }

    function closeRemoveModal() {
        pendingRemoveId = null;
        if (removeModal) removeModal.classList.add('hidden');
    }

    function removeFavorite(id) {
        var before = favorites.length;
        favorites = favorites.filter(function (fav) { return fav.id !== id; });
        if (favorites.length === before) return;
        persistFavorites();
        renderFavorites();
        if (!favorites.length && favoritesArea) {
            favoritesArea.classList.add('hidden');
            toggleFavsBtn.classList.remove('open');
            toggleFavsBtn.setAttribute('aria-expanded', 'false');
        }
    }

    function initRemoveModal() {
        if (!removeModal) return;
        removeCancelBtn.addEventListener('click', closeRemoveModal);
        removeConfirmBtn.addEventListener('click', function () {
            var id = pendingRemoveId;
            closeRemoveModal();
            if (id) removeFavorite(id);
        });
        removeModal.addEventListener('click', function (e) {
            if (e.target === removeModal) closeRemoveModal();
        });
    }

    // =========================================================
    // 5. ARRASTAR PARA REORDENAR (ponteiro único)
    // =========================================================

    var dragState = null;
    var suppressClickUntil = 0;

    function beginDrag(state) {
        var item = state.item;
        var rect = state.rect;

        state.dragging = true;
        window.clearTimeout(state.longTimer);

        var placeholder = document.createElement('div');
        placeholder.className = 'fav-item fav-placeholder';
        placeholder.setAttribute('aria-hidden', 'true');

        item.parentNode.insertBefore(placeholder, item);
        state.placeholder = placeholder;

        item.classList.add('dragging');
        item.style.width = Math.round(rect.width) + 'px';
        item.style.height = Math.round(rect.height) + 'px';
        item.style.position = 'fixed';
        item.style.left = Math.round(rect.left) + 'px';
        item.style.top = Math.round(rect.top) + 'px';
        item.style.pointerEvents = 'none';

        if (navigator.vibrate) navigator.vibrate(20);
    }

    function moveDrag(state, clientX, clientY) {
        if (state.raf) cancelAnimationFrame(state.raf);
        state.raf = requestAnimationFrame(function () {
            state.raf = null;
            var item = state.item;
            var rect = state.rect;
            item.style.left = Math.round(rect.left + (clientX - state.startX)) + 'px';
            item.style.top = Math.round(rect.top + (clientY - state.startY)) + 'px';

            var others = Array.prototype.slice.call(
                favoritesGrid.querySelectorAll('.fav-item:not(.dragging):not(.fav-placeholder)')
            );
            var closest = null;
            var closestDist = Infinity;

            others.forEach(function (other) {
                var r = other.getBoundingClientRect();
                var dist = Math.hypot(clientX - (r.left + r.width / 2), clientY - (r.top + r.height / 2));
                if (dist < closestDist) { closestDist = dist; closest = other; }
            });

            if (closest && closestDist < 90 && state.placeholder) {
                var r = closest.getBoundingClientRect();
                if (clientX < r.left + r.width / 2) {
                    favoritesGrid.insertBefore(state.placeholder, closest);
                } else {
                    favoritesGrid.insertBefore(state.placeholder, closest.nextSibling);
                }
            }
        });
    }

    function endDrag(state) {
        var item = state.item;
        window.clearTimeout(state.longTimer);
        if (state.raf) cancelAnimationFrame(state.raf);

        if (state.placeholder && state.placeholder.parentNode) {
            state.placeholder.parentNode.replaceChild(item, state.placeholder);
        }

        item.classList.remove('dragging');
        item.style.position = '';
        item.style.left = '';
        item.style.top = '';
        item.style.width = '';
        item.style.height = '';
        item.style.pointerEvents = '';

        saveNewOrder();
    }

    function saveNewOrder() {
        var ordered = [];
        Array.prototype.forEach.call(favoritesGrid.querySelectorAll('.fav-item'), function (node) {
            var fav = favorites.find(function (f) { return f.id === node.dataset.id; });
            if (fav) ordered.push(fav);
        });
        if (ordered.length !== favorites.length) return; // ordem inconsistente: não salva
        favorites = ordered;
        persistFavorites();
    }

    function attachItemEvents(item, fav, link) {
        item.addEventListener('pointerdown', function (e) {
            if (e.pointerType === 'mouse' && e.button !== 0) return;
            if (dragState) return;

            var state = {
                item: item,
                fav: fav,
                pointerId: e.pointerId,
                startX: e.clientX,
                startY: e.clientY,
                rect: item.getBoundingClientRect(),
                dragging: false,
                longPressed: false,
                placeholder: null,
                raf: null,
                longTimer: null
            };

            state.longTimer = window.setTimeout(function () {
                if (!dragState || dragState.dragging) return;
                state.longPressed = true;
                suppressClickUntil = Date.now() + 600;
                if (navigator.vibrate) navigator.vibrate(30);
                askRemove(fav);
                cleanupDrag();
            }, LONG_PRESS_MS);

            dragState = state;
        });

        item.addEventListener('contextmenu', function (e) {
            e.preventDefault();
        });

        item.addEventListener('keydown', function (e) {
            if (e.key === 'Delete' || e.key === 'Backspace') {
                e.preventDefault();
                askRemove(fav);
            }
        });

        // Clique depois de arrastar não deve abrir o site.
        link.addEventListener('click', function (e) {
            if (Date.now() < suppressClickUntil) {
                e.preventDefault();
                e.stopPropagation();
            }
        });
    }

    function cleanupDrag() {
        if (!dragState) return;
        window.clearTimeout(dragState.longTimer);
        if (dragState.placeholder && dragState.placeholder.parentNode) {
            dragState.placeholder.parentNode.removeChild(dragState.placeholder);
        }
        dragState.item.classList.remove('dragging');
        dragState.item.style.position = '';
        dragState.item.style.left = '';
        dragState.item.style.top = '';
        dragState.item.style.width = '';
        dragState.item.style.height = '';
        dragState.item.style.pointerEvents = '';
        dragState = null;
    }

    function initDragEvents() {
        document.addEventListener('pointermove', function (e) {
            if (!dragState || e.pointerId !== dragState.pointerId) return;

            var dx = e.clientX - dragState.startX;
            var dy = e.clientY - dragState.startY;

            if (!dragState.dragging && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
                beginDrag(dragState);
            }
            if (dragState.dragging) {
                if (e.cancelable) e.preventDefault();
                moveDrag(dragState, e.clientX, e.clientY);
            }
        }, { passive: false });

        function finish() {
            if (!dragState) return;
            var state = dragState;
            dragState = null;
            window.clearTimeout(state.longTimer);
            if (state.dragging) {
                suppressClickUntil = Date.now() + 250;
                endDrag(state);
            } else if (state.raf) {
                cancelAnimationFrame(state.raf);
            }
        }

        document.addEventListener('pointerup', finish);
        document.addEventListener('pointercancel', function () {
            if (dragState && dragState.dragging) suppressClickUntil = Date.now() + 250;
            if (dragState) cleanupDrag();
        });
    }

    // =========================================================
    // 6. MOSTRAR/OCULTAR FAVORITOS
    // =========================================================

    function setFavoritesOpen(open) {
        favoritesArea.classList.toggle('hidden', !open);
        toggleFavsBtn.classList.toggle('open', open);
        toggleFavsBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
        toggleFavsBtn.setAttribute('aria-label', open ? 'Ocultar favoritos' : 'Mostrar favoritos');
    }

    // =========================================================
    // 7. MODAL DE NOVO FAVORITO
    // =========================================================

    function resetFavForm() {
        favUrlInput.value = '';
        favNameInput.value = '';
        currentIconBase64 = '';
        previewContainer.classList.add('hidden');
        previewImg.removeAttribute('src');
        favFileInput.value = '';
    }

    function openFavModal() {
        resetFavForm();
        favModal.classList.remove('hidden');
        window.setTimeout(function () { favUrlInput.focus(); }, 120);
    }

    function closeFavModal() {
        favModal.classList.add('hidden');
    }

    function readImageFile(file) {
        if (file.size > 12 * 1024 * 1024) {
            alert('Imagem muito grande. Escolha um arquivo de até 12 MB.');
            return;
        }
        var reader = new FileReader();
        reader.onload = function (event) {
            var img = new Image();
            img.onload = function () {
                var MAX_SIZE = 128;
                var width = img.width;
                var height = img.height;
                if (!width || !height) { alert('Não foi possível ler essa imagem.'); return; }

                if (width > height && width > MAX_SIZE) {
                    height = Math.round(height * (MAX_SIZE / width));
                    width = MAX_SIZE;
                } else if (height >= width && height > MAX_SIZE) {
                    width = Math.round(width * (MAX_SIZE / height));
                    height = MAX_SIZE;
                }

                var canvas = document.createElement('canvas');
                canvas.width = Math.max(1, width);
                canvas.height = Math.max(1, height);
                var ctx = canvas.getContext('2d');

                // Fundo sólido: JPEG não tem transparência.
                ctx.fillStyle = '#202020';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

                try {
                    currentIconBase64 = canvas.toDataURL('image/webp', 0.85);
                } catch (err) {
                    currentIconBase64 = canvas.toDataURL('image/jpeg', 0.85);
                }
                previewImg.src = currentIconBase64;
                previewContainer.classList.remove('hidden');
            };
            img.onerror = function () { alert('Não foi possível ler essa imagem.'); };
            img.src = String(event.target.result);
        };
        reader.onerror = function () { alert('Não foi possível ler esse arquivo.'); };
        reader.readAsDataURL(file);
    }

    function initFavModal() {
        openModalBtn.addEventListener('click', openFavModal);

        cancelFavBtn.addEventListener('click', closeFavModal);
        favModal.addEventListener('click', function (e) {
            if (e.target === favModal) closeFavModal();
        });

        favUrlInput.addEventListener('input', function () {
            favUrlInput.classList.remove('input-error');
        });

        favUrlInput.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') { e.preventDefault(); favNameInput.focus(); }
        });
        favNameInput.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') { e.preventDefault(); saveFavorite(); }
        });

        uploadBtn.addEventListener('click', function () { favFileInput.click(); });

        favFileInput.addEventListener('change', function (e) {
            var file = e.target.files && e.target.files[0];
            if (!file) return;
            if (!/^image\//.test(file.type)) {
                alert('Escolha um arquivo de imagem.');
                favFileInput.value = '';
                return;
            }
            readImageFile(file);
        });

        removePreviewBtn.addEventListener('click', function () {
            currentIconBase64 = '';
            previewContainer.classList.add('hidden');
            previewImg.removeAttribute('src');
            favFileInput.value = '';
        });

        saveFavBtn.addEventListener('click', saveFavorite);
    }

    function saveFavorite() {
        var url = normalizeUrl(favUrlInput.value);
        if (!url) {
            favUrlInput.classList.add('input-error');
            favUrlInput.focus();
            alert('Digite um endereço válido, como exemplo.com');
            return;
        }

        var name = favNameInput.value.trim() || hostnameOf(url);
        var icon = currentIconBase64;

        favorites.push({
            id: 'fav-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
            name: name,
            url: url,
            icon: icon
        });

        if (!persistFavorites()) {
            favorites.pop();
            return;
        }

        renderFavorites();
        closeFavModal();
        setFavoritesOpen(true);
    }

    // =========================================================
    // 8. TECLADO GLOBAL
    // =========================================================

    function initGlobalKeys() {
        document.addEventListener('keydown', function (e) {
            if (e.key !== 'Escape') return;
            if (!favModal.classList.contains('hidden')) { closeFavModal(); return; }
            if (removeModal && !removeModal.classList.contains('hidden')) { closeRemoveModal(); return; }
            hideSuggestions();
        });
    }

    // =========================================================
    // 9. INICIAR
    // =========================================================

    function init() {
        initVideo();
        initFullscreen();
        initSearch();
        initFavModal();
        initRemoveModal();
        initDragEvents();
        initGlobalKeys();

        toggleFavsBtn.addEventListener('click', function () {
            setFavoritesOpen(favoritesArea.classList.contains('hidden'));
        });

        setFavoritesOpen(false);
        renderFavorites();

        // Abre os favoritos automaticamente se já existirem alguns.
        if (favorites.length) setFavoritesOpen(true);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
