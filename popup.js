const $ = id => document.getElementById(id);
const statusEl = $('status');
const chatSelect = $('chatSelect');
const exportBtn = $('exportBtn');
const outputArea = $('outputArea');
const outputJson = $('outputJson');
const outputMd = $('outputMd');
const tabBar = $('tabBar');
const copyBtn = $('copyBtn');
const saveBtn = $('saveBtn');
const zipBtn = $('zipBtn');
const imageGallery = $('imageGallery');
const unboldCb = $('unboldHeadings');
const stripHtmlCb = $('stripHtml');
const mdLinksCb = $('mdLinks');
const heading = $('heading');

const DEEPSEEK = 'deepseek';
const CHATGPT = 'chatgpt';

let currentMessages = [];
let currentImages = [];
let currentTitle = 'chat-export';
let activeTab = 'json';
let rawMarkdown = '';

let sessionState = { platform: null, tabId: null, cursor: null, hasMore: false, loading: false };

function setStatus(msg, isError) {
    statusEl.textContent = msg;
    statusEl.className = isError ? 'error' : '';
}

function showOnly(el) {
    [statusEl, chatSelect, exportBtn, outputArea].forEach(e => e.classList.add('hidden'));
    el.classList.remove('hidden');
}

function getDisplayMessages() {
    if (!mdLinksCb.checked) return currentMessages;
    return currentMessages.map(msg => ({ ...msg, content: markdownifyChatGPTLinks(msg.content) }));
}

function updateOutputView() {
    const isJson = activeTab === 'json';
    if (isJson) {
        outputJson.classList.remove('hidden');
        outputMd.classList.add('hidden');
        outputJson.value = JSON.stringify(getDisplayMessages(), null, 2);
    } else {
        outputJson.classList.add('hidden');
        outputMd.classList.remove('hidden');
        rawMarkdown = applyTransforms(toMarkdown(currentMessages));
        outputMd.innerHTML = '<p style="color:#888">Loading...</p>';
        setTimeout(() => {
            outputMd.innerHTML = marked.parse(rawMarkdown);
        }, 0);
    }
    copyBtn.textContent = isJson ? 'Copy JSON' : 'Copy Markdown';
    saveBtn.textContent = isJson ? 'Save JSON' : 'Save Markdown';
}

function showOutput(messages, title, images, pageTitle) {
    currentMessages = messages;
    currentTitle = title || 'chat-export';
    currentImages = images || [];
    heading.textContent = pageTitle ? `Chat Export | ${pageTitle}` : 'Chat Export';
    showOnly(outputArea);
    updateOutputView();
    renderImages(currentImages);
    zipBtn.classList.toggle('hidden', currentImages.length === 0);
}

function toMarkdown(messages) {
    return messages.map(msg => {
        const label = msg.role === 'tool' ? 'Assistant' : msg.role.charAt(0).toUpperCase() + msg.role.slice(1);
        return `## ${label}:\n\n${msg.content}\n\n---\n`;
    }).join('\n');
}

function applyTransforms(md) {
    if (unboldCb.checked) md = unboldHeadings(md);
    if (stripHtmlCb.checked) md = escapeHtmlOutsideCode(md);
    if (mdLinksCb.checked) md = markdownifyChatGPTLinks(md);
    md = replaceImageRefs(md);
    return md;
}

function replaceImageRefs(md) {
    for (const img of currentImages) {
        if (img.mime && img.base64) {
            const dataUrl = `data:${img.mime};base64,${img.base64}`;
            md = md.replaceAll(`![${img.file_id}](${img.file_id}.${img.ext})`, `![${img.file_id}](${dataUrl})`);
        }
    }
    return md;
}

function markdownifyChatGPTLinks(md) {
    return md.replace(/\uE200url\uE202([^\uE202]+)\uE202([^\uE201]+)\uE201/g, '[$1]($2)');
}

function unboldHeadings(md) {
    return md.replace(/^(#+\s+)\*\*(.+?)\*\*\s*$/gm, '$1$2');
}

function escapeHtmlOutsideCode(md) {
    const parts = md.split(SKIP);
    return parts.map((part, i) => {
        if (i % 2 === 1) return part;
        const tags = [];
        let text = part.replace(TAG_RE, m => { tags.push(m); return `\x00TAG${tags.length-1}\x00`; });
        text = text.replace(COMMENT_RE, m => { tags.push(m); return `\x00TAG${tags.length-1}\x00`; });
        text = text.replace(/</g, '\\<').replace(/>/g, '\\>');
        return text.replace(/\x00TAG(\d+)\x00/g, (_, n) => tags[+n]);
    }).join('');
}
const SKIP = /(```[\s\S]*?```|`[^`\n]+`)/g;
const TAG_RE = /(<\/?(?:details|summary|ul|li|a)(?:\s[^>]*)?>)/gi;
const COMMENT_RE = /(<!--[\s\S]*?-->)/gi;

function saveFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

async function injectAndFetch(tabId, fn, args) {
    let results;
    try {
        results = await chrome.scripting.executeScript({
            target: { tabId },
            world: 'MAIN',
            func: fn,
            args
        });
    } catch {}
    return results?.[0]?.result ?? { error: 'Script execution failed' };
}

// ## Deepseek

function fetchDeepseekSessionsPage(cursorUpdatedAt) {
    try {
        const token = JSON.parse(localStorage.getItem('userToken')).value;
        const params = new URLSearchParams();
        params.set('lte_cursor.pinned', 'false');
        if (cursorUpdatedAt) params.set('lte_cursor.updated_at', String(cursorUpdatedAt));
        return fetch(`https://chat.deepseek.com/api/v0/chat_session/fetch_page?${params}`, {
            headers: {
                'accept': '*/*', 'authorization': `Bearer ${token}`,
                'x-app-version': '2.0.0', 'x-client-bundle-id': 'com.deepseek.chat.nov',
                'x-client-locale': 'en_US', 'x-client-platform': 'web', 'x-client-version': '2.0.0'
            },
            credentials: 'include'
        }).then(r => r.json());
    } catch { return { error: 'Not logged in (no token found)' }; }
}

function fetchDeepseekChatHistory(uuid) {
    try {
        const token = JSON.parse(localStorage.getItem('userToken')).value;
        return fetch(`https://chat.deepseek.com/api/v0/chat/history_messages?chat_session_id=${uuid}`, {
            headers: {
                'accept': '*/*', 'authorization': `Bearer ${token}`,
                'x-app-version': '2.0.0', 'x-client-bundle-id': 'com.deepseek.chat.nov',
                'x-client-locale': 'en_US', 'x-client-platform': 'web', 'x-client-version': '2.0.0'
            },
            credentials: 'include'
        }).then(r => r.json());
    } catch { return { error: 'Not logged in (no token found)' }; }
}

function transformDeepseekMessages(data) {
    const messages = data?.data?.biz_data?.chat_messages || [];
    return messages.map(msg => {
        const fragments = (msg.fragments || []).filter(f => f.type !== 'TIP');
        let content = '';
        const seen = new Set();
        const searchItems = [];
        for (const f of fragments) {
            if (f.type === 'SEARCH') {
                for (const r of f.results || []) {
                    if (!seen.has(r.url)) { seen.add(r.url); searchItems.push(r); }
                }
            } else if (f.type === 'THINK') {
                const secs = Math.round(f.elapsed_secs || 0);
                content += `<details><summary>💭 Thought for ${secs}s</summary>\n${f.content}\n</details>\n\n`;
            } else {
                content += f.content || '';
            }
        }
        const citeMap = new Map();
        for (const r of searchItems) { if (r.cite_index) citeMap.set(r.cite_index, { title: r.title, url: r.url }); }
        if (citeMap.size) {
            let n = 0;
            const fnDefs = [];
            const used = new Map();
            content = content.replace(/\[citation:(\d+)\]/g, (_, idx) => {
                const ref = citeMap.get(parseInt(idx));
                if (!ref) return _;
                if (!used.has(ref.url)) { n++; used.set(ref.url, `${n}`); fnDefs.push(`[^${n}]: [${ref.title}](${ref.url})`); }
                return `[^${used.get(ref.url)}]`;
            });
            if (fnDefs.length) content += '\n\n' + fnDefs.join('\n');
        }
        if (searchItems.length) {
            const lines = searchItems.map(r => {
                let line = `<li><a href="${r.url}">${r.title}</a>`;
                if (r.snippet) line += `: ${r.snippet}`;
                return line + '</li>';
            });
            content = `<details><summary>🔎 Search - ${searchItems.length} results</summary>\n\n<ul>\n${lines.join('\n')}\n</ul>\n\n</details>\n\n` + content;
        }
        return { id: msg.message_id, role: (msg.role || '').toLowerCase(), content };
    });
}

// ## ChatGPT

function fetchAndTransformChatGPT(uuid) {
    function token() {
        try { return JSON.parse(document.querySelector('#client-bootstrap').innerText).session.accessToken; }
        catch { return null; }
    }
    function headers(t, path, route) {
        return {
            'accept': '*/*', 'authorization': `Bearer ${t}`,
            'oai-client-build-number': '7804768',
            'oai-client-version': 'prod-eb0d883367d069bacb5f7b5c0a5400183a5ba287',
            'oai-device-id': localStorage.getItem('oai-device-id') || '',
            'oai-language': navigator.language || 'en-US',
            'oai-session-id': localStorage.getItem('oai-session-id') || '',
            'x-openai-target-path': path, 'x-openai-target-route': route
        };
    }
    
    return (async () => {
        const t = token();
        if (!t) return { error: 'Not logged in' };
        
        const resp = await fetch(`https://chatgpt.com/backend-api/conversation/${uuid}`, {
            headers: headers(t, `/backend-api/conversation/${uuid}`, '/backend-api/conversation/{conversation_id}'),
            credentials: 'include'
        });
        const data = await resp.json();
        if (!data?.mapping) return { error: 'No mapping data' };
        
        const mapping = data.mapping;
        const root = Object.values(mapping).find(n => !n.parent);
        if (!root) return { error: 'No root node' };
        
        const messages = [];
        const imageRefs = [];
        const visited = new Set();
        
        function processCitations(content, refs) {
            if (!refs?.length) return content;
            let result = content;
            const fnDefs = [];
            const seen = new Map();
            let n = 0;
            for (const ref of refs) {
                if (!ref.matched_text) continue;
                if (ref.type === 'alt_text' && ref.alt) {
                    result = result.replaceAll(ref.matched_text, ref.alt);
                } else if (ref.type === 'grouped_webpages' && ref.items?.length) {
                    const item = ref.items[0];
                    if (!seen.has(item.url)) { n++; seen.set(item.url, `${n}`); fnDefs.push(`[^${n}]: [${item.title}](${item.url})`); }
                    result = result.replaceAll(ref.matched_text, `[^${seen.get(item.url)}]`);
                } else if (ref.type === 'sources_footnote' && ref.sources?.length) {
                    for (const src of ref.sources) {
                        if (!seen.has(src.url)) { n++; seen.set(src.url, `${n}`); fnDefs.push(`[^${n}]: [${src.title}](${src.url})`); }
                    }
                }
            }
            if (fnDefs.length) result += '\n\n' + fnDefs.join('\n');
            return result;
        }
        
        function walk(id) {
            if (visited.has(id)) return;
            visited.add(id);
            const node = mapping[id];
            if (!node) return;
            
            if (node.message) {
                const msg = node.message;
                const role = msg.author?.role;
                const hidden = msg.metadata?.is_visually_hidden_from_conversation;
                
                if (!hidden && role && role !== 'system') {
                    const parts = msg.content?.parts || [];
                    let content = '';
                    for (const p of parts) {
                        if (typeof p === 'string') {
                            content += p;
                        } else if (p?.content_type === 'image_asset_pointer') {
                            const fileId = (p.asset_pointer || '').replace(/^.*\/\//, '');
                            const ext = 'png';
                            imageRefs.push({ file_id: fileId, ext, asset_pointer: p.asset_pointer });
                            content += `![${fileId}](${fileId}.${ext})`;
                        } else if (p?.content_type === 'multimodal_text' && Array.isArray(p.parts)) {
                            for (const s of p.parts) {
                                if (typeof s === 'string') content += s;
                            }
                        }
                    }
                    if (content) {
                        const refs = msg.metadata?.content_references || [];
                        let processed = processCitations(content, refs);
                        const searchGroups = msg.metadata?.search_result_groups || [];
                        if (searchGroups.length) {
                            const seen = new Set();
                            const items = [];
                            for (const g of searchGroups) {
                                for (const e of g.entries || []) {
                                    if (!seen.has(e.url)) { seen.add(e.url); items.push(e); }
                                }
                            }
                            if (items.length) {
                                const lines = items.map(e => {
                                    let line = `<li><a href="${e.url}">${e.title}</a>`;
                                    if (e.snippet) line += `: ${e.snippet}`;
                                    return line + '</li>';
                                });
                                processed = `<details><summary>🔎 Search - ${items.length} results</summary>\n\n<ul>\n${lines.join('\n')}\n</ul>\n\n</details>\n\n` + processed;
                            }
                        }
                        messages.push({ id: msg.id, role, content: processed });
                    }
                }
            }
            
            for (const cid of node.children || []) walk(cid);
        }
        
        walk(root.id);
        
        for (const ref of imageRefs) {
            try {
                const dlResp = await fetch(`https://chatgpt.com/backend-api/files/download/${ref.file_id}?conversation_id=${uuid}&inline=false&download_intent=false`, {
                    headers: headers(t, `/backend-api/files/download/${ref.file_id}`, '/backend-api/files/download/{file_id}'),
                    credentials: 'include'
                });
                const dlData = await dlResp.json();
                if (dlData.download_url) {
                    const imgResp = await fetch(dlData.download_url);
                    const blob = await imgResp.blob();
                    const buf = await blob.arrayBuffer();
                    const bytes = new Uint8Array(buf);
                    let bin = '';
                    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
                    ref.base64 = btoa(bin);
                    const mimeExt = blob.type.split('/')[1];
                    if (mimeExt && mimeExt.length < 5) ref.ext = mimeExt;
                    ref.mime = blob.type;
                    ref.filename = dlData.file_name || `${ref.file_id}.${ref.ext}`;
                }
            } catch {}
        }
        
        return { messages, images: imageRefs, title: data.title, pageTitle: document.title };
    })();
}

function fetchChatGPTSessionsPage(offset) {
    function token() {
        try { return JSON.parse(document.querySelector('#client-bootstrap').innerText).session.accessToken; }
        catch { return null; }
    }
    function headers(t, path, route) {
        return {
            'accept': '*/*', 'authorization': `Bearer ${t}`,
            'oai-client-build-number': '7804768',
            'oai-client-version': 'prod-eb0d883367d069bacb5f7b5c0a5400183a5ba287',
            'oai-device-id': localStorage.getItem('oai-device-id') || '',
            'oai-language': navigator.language || 'en-US',
            'oai-session-id': localStorage.getItem('oai-session-id') || '',
            'x-openai-target-path': path, 'x-openai-target-route': route
        };
    }
    try {
        const t = token();
        if (!t) return { error: 'Not logged in' };
        return fetch(`https://chatgpt.com/backend-api/conversations?offset=${offset}&limit=28&order=updated&is_archived=false&is_starred=false`, {
            headers: headers(t, '/backend-api/conversations', '/backend-api/conversations'),
            credentials: 'include'
        }).then(r => r.json());
    } catch { return { error: 'Failed to fetch sessions' }; }
}

// ### Images

function renderImages(images) {
    imageGallery.innerHTML = '';
    if (!images.length) { imageGallery.classList.add('hidden'); return; }
    imageGallery.classList.remove('hidden');
    images.forEach(img => {
        const card = document.createElement('div');
        card.className = 'img-card';
        const dataUrl = `data:${img.mime || 'image/png'};base64,${img.base64}`;
        card.innerHTML = `
      <img src="${dataUrl}" alt="${img.file_id}">
      <div class="img-name">${img.file_id}.${img.ext}</div>
      <button class="dl-one">Download</button>`;
        card.querySelector('.dl-one').addEventListener('click', () => {
            saveFile(base64ToBytes(img.base64, img.mime || 'image/png'), `${img.file_id}.${img.ext}`, img.mime || 'image/png');
        });
        imageGallery.appendChild(card);
    });
}

function base64ToBytes(b64, mime) {
    const bin = atob(b64);
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    return new Blob([buf], { type: mime });
}

async function downloadZIP() {
    const safeTitle = currentTitle.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || 'chat-export';
    const zip = new JSZip();
    
    zip.file(`${safeTitle}.json`, JSON.stringify(getDisplayMessages(), null, 2));
    zip.file(`${safeTitle}.md`, rawMarkdown);
    
    if (currentImages.length) {
        const imgFolder = zip.folder('images');
        currentImages.forEach(img => {
            const bin = atob(img.base64);
            const buf = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
            imgFolder.file(`${img.file_id}.${img.ext}`, buf);
        });
    }
    
    const blob = await zip.generateAsync({ type: 'blob' });
    saveFile(blob, `${safeTitle}.zip`, 'application/zip');
}

// ### Lazy-Loading sessions

function resetSessionLoader() {
    sessionState = { platform: null, tabId: null, cursor: null, hasMore: false, loading: false };
    chatSelect.innerHTML = '';
}

async function loadMoreSessions() {
    if (sessionState.loading || !sessionState.hasMore) return;
    sessionState.loading = true;
    
    let raw;
    if (sessionState.platform === DEEPSEEK) {
        raw = await injectAndFetch(sessionState.tabId, fetchDeepseekSessionsPage, [sessionState.cursor]);
        if (raw.error) { setStatus(raw.error, true); sessionState.loading = false; return; }
        const biz = raw.data?.biz_data;
        if (!biz) { sessionState.hasMore = false; sessionState.loading = false; return; }
        appendSessions(biz.chat_sessions || [], DEEPSEEK);
        sessionState.hasMore = !!biz.has_more;
        if (biz.has_more && biz.chat_sessions?.length)
            sessionState.cursor = biz.chat_sessions[biz.chat_sessions.length - 1].updated_at;
    } else if (sessionState.platform === CHATGPT) {
        raw = await injectAndFetch(sessionState.tabId, fetchChatGPTSessionsPage, [sessionState.cursor || 0]);
        if (raw.error) { setStatus(raw.error, true); sessionState.loading = false; return; }
        const items = raw.items || [];
        appendSessions(items, CHATGPT);
        sessionState.hasMore = items.length === 28;
        sessionState.cursor = (sessionState.cursor || 0) + items.length;
    }
    
    sessionState.loading = false;
    exportBtn.classList.remove('hidden');
}

function appendSessions(items, platform) {
    const fragment = document.createDocumentFragment();
    items.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = platform === DEEPSEEK
        ? `${s.title}  —  ${new Date(s.updated_at * 1000).toLocaleString()}`
        : `${s.title}  —  ${new Date(s.update_time).toLocaleString()}`;
        fragment.appendChild(opt);
    });
    chatSelect.appendChild(fragment);
}

// ## Supported Platforms

function showUnsupported(tab) {
    const pageTitle = tab.title || tab.url;
    const issueUrl = `https://github.com/uukelele/chat-export/issues/new?title=${encodeURIComponent('Support for ' + pageTitle)}&body=${encodeURIComponent('I would like to request support for the platform [' + pageTitle + '](' + tab.url + ')')}`;
    statusEl.innerHTML = `This website is not currently supported. <a href="${issueUrl}" target="_blank" style="color:var(--accent)">Request Support</a>`;
    statusEl.className = 'error';
}

async function handleDeepseekDetail(tab, uuid) {
    setStatus('Fetching chat history...');
    const data = await injectAndFetch(tab.id, fetchDeepseekChatHistory, [uuid]);
    if (data.error) { setStatus(data.error, true); return; }
    const title = data?.data?.biz_data?.chat_session?.title;
    showOutput(transformDeepseekMessages(data), title, [], tab.title || document.title);
}

async function handleChatGPTDetail(tab, uuid) {
    setStatus('Fetching chat history...');
    const result = await injectAndFetch(tab.id, fetchAndTransformChatGPT, [uuid]);
    if (result.error) { setStatus(result.error, true); return; }
    showOutput(result.messages, result.title, result.images, result.pageTitle);
}

async function handleSessionList(tab, platform) {
    setStatus('Loading sessions...');
    showOnly(statusEl);
    resetSessionLoader();
    sessionState = { platform, tabId: tab.id, cursor: null, hasMore: true, loading: false };
    chatSelect.classList.remove('hidden');
    await loadMoreSessions();
}

async function main() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) { setStatus('No active tab found', true); return; }
    
    const url = new URL(tab.url);
    const host = url.hostname;
    
    if (host === 'chat.deepseek.com') {
        const m = url.pathname.match(/\/a\/chat\/s\/([0-9a-f-]+)/);
        if (m) return handleDeepseekDetail(tab, m[1]);
        return handleSessionList(tab, DEEPSEEK);
    }
    
    if (host === 'chatgpt.com') {
        const m = url.pathname.match(/\/c\/([0-9a-f-]+)/);
        if (m) return handleChatGPTDetail(tab, m[1]);
        return handleSessionList(tab, CHATGPT);
    }
    
    showUnsupported(tab);
}

// ## Event listeners

tabBar.addEventListener('click', e => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    tabBar.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    activeTab = tab.dataset.tab;
    updateOutputView();
});

let scrollTimeout;
chatSelect.addEventListener('scroll', () => {
    clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(() => {
        const el = chatSelect;
        if (el.scrollTop + el.clientHeight >= el.scrollHeight - 30) loadMoreSessions();
    }, 150);
});

copyBtn.addEventListener('click', async () => {
    const text = activeTab === 'json' ? outputJson.value : rawMarkdown;
    if (!text) return;
    try {
        await navigator.clipboard.writeText(text);
        const orig = copyBtn.textContent;
        copyBtn.textContent = 'Copied!';
        setTimeout(() => copyBtn.textContent = orig, 1500);
    } catch {
        const orig = copyBtn.textContent;
        copyBtn.textContent = 'Failed';
        setTimeout(() => copyBtn.textContent = orig, 1500);
    }
});

saveBtn.addEventListener('click', () => {
    const text = activeTab === 'json' ? outputJson.value : rawMarkdown;
    if (!text) return;
    const ext = activeTab === 'json' ? 'json' : 'md';
    const safeTitle = currentTitle.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || 'chat-export';
    saveFile(text, `${safeTitle}.${ext}`, ext === 'json' ? 'application/json' : 'text/markdown');
});

zipBtn.addEventListener('click', downloadZIP);

unboldCb.addEventListener('change', updateOutputView);
stripHtmlCb.addEventListener('change', updateOutputView);
mdLinksCb.addEventListener('change', updateOutputView);

exportBtn.addEventListener('click', async () => {
    const selectedId = chatSelect.value;
    if (!selectedId) return;
    setStatus('Fetching chat history...');
    showOnly(statusEl);
    
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const platform = sessionState.platform;
    
    if (platform === DEEPSEEK) {
        const data = await injectAndFetch(tab.id, fetchDeepseekChatHistory, [selectedId]);
        if (data.error) { setStatus(data.error, true); return; }
        const title = data?.data?.biz_data?.chat_session?.title;
        showOutput(transformDeepseekMessages(data), title, [], tab.title || document.title);
    } else if (platform === CHATGPT) {
        const result = await injectAndFetch(tab.id, fetchAndTransformChatGPT, [selectedId]);
        if (result.error) { setStatus(result.error, true); return; }
        showOutput(result.messages, result.title, result.images, result.pageTitle);
    }
});

main();