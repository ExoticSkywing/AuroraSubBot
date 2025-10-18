// MoonTV Register Bot - Cloudflare Worker
// API-based user registration system for MoonTV platform

// User-Agent 标识
const USER_AGENT = "CF-Workers-MoonTVRegisterBot/cmliu";

// 生成初始密码
function generateInitialPassword(userId) {
    const timestamp = Date.now();
    const rawText = `${userId}${timestamp}`;
    return crypto.subtle.digest('MD5', new TextEncoder().encode(rawText))
        .then(hashBuffer => {
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            return hashArray.map(byte => byte.toString(16).padStart(2, '0')).join('').substring(0, 8);
        });
}

// 获取延迟状态描述
function getLatencyStatus(responseTime) {
    if (!responseTime) return '未知';
    
    const thresholds = [
        { max: 300, status: '良好' },
        { max: 1000, status: '一般' },
        { max: Infinity, status: '拥挤' }
    ];
    
    return thresholds.find(t => responseTime < t.max).status;
}

// 提取基础域名URL
function extractBaseUrl(url) {
    try {
        const urlObj = new URL(url);
        return `${urlObj.protocol}//${urlObj.host}`;
    } catch (error) {
        // 如果URL解析失败，返回原始URL
        console.error('URL解析失败:', error);
        return url;
    }
}

// 简易字节格式化
function formatBytes(bytes) {
    if (typeof bytes !== 'number' || !isFinite(bytes) || bytes < 0) return '未知';
    const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    if (bytes === 0) return '0 B';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    const value = bytes / Math.pow(1024, i);
    return `${value.toFixed(i >= 2 ? 2 : 1)} ${units[i]}`;
}

function createProgressBar(percentage) {
    const total = 10;
    const filled = Math.min(total, Math.max(0, Math.round((percentage / 100) * total)));
    return '█'.repeat(filled) + '░'.repeat(total - filled);
}

function extractHostname(u) {
    try { return new URL(u).hostname; } catch { return '未知'; }
}

function decodeNodeName(link) {
    const idx = link.lastIndexOf('#');
    if (idx === -1) return null;
    try { return decodeURIComponent(link.substring(idx + 1)); } catch { return link.substring(idx + 1); }
}

function detectCountries(names) {
    const found = new Set();
    for (const name of names || []) {
        const c = extractCountry(name);
        if (c) found.add(c);
    }
    return Array.from(found);
}

function buildTopN(list, n) {
    const counter = new Map();
    for (const item of list) {
        if (!item) continue;
        const key = String(item);
        counter.set(key, (counter.get(key) || 0) + 1);
    }
    return Array.from(counter.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, Math.max(1, Math.min(n, counter.size)))
        .map(([k, v]) => ({ key: k, count: v }));
}

function renderBarChart(items, total, width = 12) {
    const lines = [];
    for (const { key, count } of items) {
        const ratio = total > 0 ? count / total : 0;
        const filled = Math.max(1, Math.round(ratio * width));
        const bar = '█'.repeat(filled) + '░'.repeat(Math.max(0, width - filled));
        const percent = (ratio * 100).toFixed(0).padStart(3, ' ');
        lines.push(`${key.padEnd(10, ' ')} ${bar} ${percent}% (${count})`);
    }
    return lines;
}

function extractCountry(name) {
    if (!name) return null;
    const s = String(name);
    const rules = [
        ['香港', /(香港|\bHK\b|HKG|🇭🇰)/i],
        ['日本', /(日本|\bJP\b|🇯🇵|东京|大阪|名古屋|札幌|福冈|冲绳|神户|Tokyo|Osaka|Nagoya|Sapporo|Fukuoka|Okinawa|Kobe|NRT|HND)/i],
        ['韩国', /(韩国|\bKR\b|🇰🇷|首尔|釜山|仁川|大邱|光州|春川|水原|Seoul|Busan|Incheon|Daegu|Gwangju|Chuncheon|Suwon|ICN|GMP)/i],
        ['中国', /(中国|\bCN\b|🇨🇳|北京|上海|广州|深圳|杭州|南京|成都|西安|重庆|天津)/i],
        ['台湾', /(台湾|\bTW\b|🇹🇼|台北|台中|高雄|新北|桃园|TPE|KHH)/i],
        ['美国', /(美国|\bUS(A)?\b|🇺🇸|洛杉矶|芝加哥|达拉斯|纽约|西雅图|硅谷|圣何塞|拉斯维加斯|迈阿密|波特兰|Seattle|Los\s*Angeles|LA\b|Chicago|Dallas|New\s*York|NYC|San\s*Jose|Las\s*Vegas|Miami|Portland|SJC|LAX|SEA|DFW)/i],
        ['新加坡', /(新加坡|\bSG\b|🇸🇬|Singapore)/i],
        ['马来西亚', /(马来西亚|\bMY\b|🇲🇾|吉隆坡|Kuala\s*Lumpur|\bKL\b|KUL|槟城|Penang|新山|Johor|亚庇|Kota\s*Kinabalu|古晋|Kuching)/i],
        ['印度尼西亚', /(印尼|印度尼西亚|\bID\b|🇮🇩|雅加达|Jakarta|JKT|泗水|Surabaya|SUB|巴厘|Bali|登巴萨|Denpasar|DPS|万隆|Bandung|BDO|日惹|Yogyakarta|JOG)/i],
        ['泰国', /(泰国|\bTH\b|🇹🇭|曼谷|Bangkok|BKK|清迈|Chiang\s*Mai|CNX|普吉|Phuket|HKT|芭提雅|Pattaya)/i],
        ['越南', /(越南|\bVN\b|🇻🇳|胡志明|Ho\s*Chi\s*Minh|SGN|西贡|河内|Hanoi|HAN|岘港|Da\s*Nang|DAD)/i],
        ['菲律宾', /(菲律宾|\bPH\b|🇵🇭|马尼拉|Manila|MNL|宿务|Cebu|CEB|达沃|Davao)/i],
        ['柬埔寨', /(柬埔寨|\bKH\b|🇰🇭|金边|Phnom\s*Penh|PNH|暹粒|Siem\s*Reap|REP)/i],
        ['老挝', /(老挝|\bLA\b|🇱🇦|万象|Vientiane|VTE|琅勃拉邦|Luang\s*Prabang|LPQ)/i],
        ['缅甸', /(缅甸|\bMM\b|🇲🇲|仰光|Yangon|RGN|曼德勒|Mandalay|MDL)/i],
        ['文莱', /(文莱|\bBN\b|🇧🇳|斯里巴加湾市|Bandar\s*Seri\s*Begawan|BWN)/i],
        ['德国', /(德国|\bDE\b|🇩🇪|法兰克福|慕尼黑|柏林|Frankfurt|Munich|Berlin|FRA|MUC|BER)/i],
        ['英国', /(英国|\bUK\b|🇬🇧|伦敦|London|曼彻斯特|Manchester|\bLON\b|LHR)/i],
        ['法国', /(法国|\bFR\b|🇫🇷|巴黎|Paris|Marseille|CDG)/i],
        ['荷兰', /(荷兰|\bNL\b|🇳🇱|阿姆斯特丹|Amsterdam|AMS)/i],
        ['巴西', /(巴西|\bBR\b|🇧🇷|圣保罗|Sao\s*Paulo|GRU)/i],
        ['澳大利亚', /(澳大利亚|澳洲|\bAU\b|🇦🇺|悉尼|墨尔本|Sydney|Melbourne|SYD|MEL)/i],
        ['墨西哥', /(墨西哥|\bMX\b|🇲🇽|墨西哥城|Monterrey|Guadalajara|MEX)/i],
        ['土耳其', /(土耳其|\bTR\b|🇹🇷|伊斯坦布尔|Istanbul|IST)/i],
        ['俄罗斯', /(俄罗斯|\bRU\b|🇷🇺|莫斯科|圣彼得堡|Moscow|Saint\s*Petersburg|MSK|LED)/i]
    ];
    for (const [label, re] of rules) {
        if (re.test(s)) return label;
    }
    return null;
}

function sampleArray(arr, n) {
    if (!Array.isArray(arr) || arr.length === 0 || n <= 0) return [];
    const copy = arr.slice();
    for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy.slice(0, Math.min(n, copy.length));
}

function parseProtocolsFrom(content, nodes) {
    const protoSet = new Set();
    const addFrom = (s) => {
        if (!s) return;
        const re = /(ss|ssr|vmess|vless|trojan|hysteria2?|hy|hy2|tuic|anytls|socks5):\/\//gi;
        let m; while ((m = re.exec(s)) !== null) { protoSet.add(m[1].toUpperCase()); }
    };
    addFrom(content);
    if (Array.isArray(nodes)) nodes.forEach(n => addFrom(n));
    return Array.from(protoSet).map(normalizeProtocolName);
}

// ===== 使用统计：每日唯一用户与使用次数 =====
function getDateKey(offsetDays = 0, tzOffsetMinutes = 480) {
    const now = Date.now() + tzOffsetMinutes * 60 * 1000 + offsetDays * 24 * 3600 * 1000;
    const d = new Date(now);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
}

async function recordDailyUsage(KV, userId, displayName) {
    try {
        if (!KV || !userId) return;
        const key = `usage:${getDateKey(0)}`;
        const raw = await KV.get(key);
        const obj = raw ? JSON.parse(raw) : { counts: {}, names: {}, first_ts: Date.now() };
        const uid = String(userId);
        obj.counts[uid] = (obj.counts[uid] || 0) + 1;
        if (displayName) obj.names[uid] = String(displayName).slice(0, 64);
        obj.last_ts = Date.now();
        await KV.put(key, JSON.stringify(obj), { expirationTtl: 60 * 24 * 3600 });
    } catch {}
}

async function getDailyUsage(KV, offsetDays = 0) {
    try {
        const key = `usage:${getDateKey(offsetDays)}`;
        const raw = await KV.get(key);
        if (!raw) return { date: key.slice(6), counts: {}, names: {}, unique: 0, total: 0 };
        const obj = JSON.parse(raw);
        const counts = obj.counts || {};
        const total = Object.values(counts).reduce((a, b) => a + (Number(b) || 0), 0);
        const unique = Object.keys(counts).length;
        return { date: key.slice(6), counts, names: obj.names || {}, unique, total };
    } catch {
        return { date: getDateKey(offsetDays), counts: {}, names: {}, unique: 0, total: 0 };
    }
}

function normalizeProtocolName(protoRaw) {
    if (!protoRaw) return '';
    const p = String(protoRaw).toUpperCase();
    if (p === 'HY' || p === 'HYSTERIA') return 'Hysteria';
    if (p === 'HY2' || p === 'HYSTERIA2') return 'Hysteria2';
    const map = {
        'VMESS': 'VMESS',
        'VLESS': 'VLESS',
        'TROJAN': 'TROJAN',
        'SS': 'SS',
        'SSR': 'SSR',
        'TUIC': 'TUIC',
        'ANYTLS': 'ANYTLS',
        'SOCKS5': 'SOCKS5'
    };
    return map[p] || p;
}

// 计算简单指纹（SHA-256(secret + '|' + text)）
async function fingerprint(secret, text) {
    const encoder = new TextEncoder();
    const data = encoder.encode(`${secret}|${text}`);
    const digest = await crypto.subtle.digest('SHA-256', data);
    const bytes = Array.from(new Uint8Array(digest));
    return bytes.map(b => b.toString(16).padStart(2, '0')).join('');
}

function getDomainFromUrl(u) {
    try { return new URL(u).hostname; } catch { return null; }
}

// AES-GCM 加解密（使用 secret 派生 256-bit key）
async function deriveAesKey(secret) {
    const enc = new TextEncoder();
    const hash = await crypto.subtle.digest('SHA-256', enc.encode(secret));
    return await crypto.subtle.importKey('raw', hash, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

function abToBase64(buf) {
    const bytes = new Uint8Array(buf);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
}

function base64ToAb(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
}

async function encryptText(secret, plaintext) {
    const key = await deriveAesKey(secret);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const enc = new TextEncoder().encode(plaintext);
    const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc);
    // 返回 iv:cipher 的base64
    return `${abToBase64(iv)}:${abToBase64(cipher)}`;
}

async function decryptText(secret, payload) {
    try {
        const [ivB64, cipherB64] = String(payload).split(':');
        const key = await deriveAesKey(secret);
        const iv = new Uint8Array(base64ToAb(ivB64));
        const cipher = base64ToAb(cipherB64);
        const plainAb = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
        return new TextDecoder().decode(plainAb);
    } catch {
        return null;
    }
}

// JP/KR 识别（国旗/国家/城市）
function detectHasJapanAndKorea(names, coverage = []) {
    const pool = [];
    if (Array.isArray(names)) pool.push(...names);
    if (Array.isArray(coverage)) pool.push(...coverage);
    const text = pool.join(' ');
    const jpTokens = ['日本', 'JP', '🇯🇵', '东京', '大阪', '名古屋', '札幌', '福冈', '冲绳', '神户', 'Tokyo', 'Osaka'];
    const krTokens = ['韩国', 'KR', '🇰🇷', '首尔', '釜山', '仁川', '大邱', '光州', '春川', '水原', 'Seoul', 'Busan'];
    const hasJp = jpTokens.some(t => text.includes(t));
    const hasKr = krTokens.some(t => text.includes(t));
    return hasJp && hasKr;
}

function detectIspQualityKeywords(text) {
    if (!text) return false;
    const re = /(家宽|家庭宽带|家用宽带|住宅|原生|专线|IEPL|IPLC|BGP|精品|原生IP|高速)/i;
    return re.test(text);
}

function detectSpamKeywords(text) {
    if (!text) return false;
    const re = /(频道|telegram|电报|\btg\b|@)/i;
    return re.test(text);
}

function hasResetRemainderText(text) {
    if (!text) return false;
    const re = /(重置剩余|距离下次重置).{0,10}?(\d+)\s*天/i;
    return re.test(text);
}

function parseUserInfoHeader(headerVal) {
    if (!headerVal) return null;
    try {
        const parts = String(headerVal).split(/;\s*/).filter(Boolean);
        const obj = {};
        for (const p of parts) {
            const m = p.match(/(upload|download|total|expire)\s*=\s*(\d+)/i);
            if (m) obj[m[1].toLowerCase()] = Number(m[2]);
        }
        const has = (k) => Object.prototype.hasOwnProperty.call(obj, k);
        if (has('upload') || has('download') || has('total') || has('expire')) {
            return {
                upload: obj.upload || 0,
                download: obj.download || 0,
                total: obj.total || 0,
                expire: typeof obj.expire === 'number' ? obj.expire : 0
            };
        }
    } catch {}
    return null;
}

async function fetchSubscriptionUserInfo(subUrl, method = 'GET', ua = 'v2rayN/6.45') {
    try {
        const resp = await fetch(subUrl, { method, headers: { 'User-Agent': ua, 'Cache-Control': 'no-cache' } });
        const h = resp.headers.get('subscription-userinfo') || resp.headers.get('Subscription-Userinfo');
        return { info: parseUserInfoHeader(h), header: h || null, method, ua };
    } catch {
        return { info: null, header: null, method, ua };
    }
}

async function fetchUserInfoFromCandidates(subUrl, substoreBase, substoreName) {
    // 依次尝试：原始 URL -> Sub-Store 中转 target=uri；每个 URL 上 HEAD/GET × 多 UA
    const candidates = [subUrl];
    try {
        if (substoreBase && substoreName) {
            const base = substoreBase.replace(/\/$/, '');
            const urlParam = encodeURIComponent(subUrl);
            candidates.push(`${base}/download/${encodeURIComponent(substoreName)}?url=${urlParam}&target=uri&ua=v2rayN/6.45&noCache=true`);
        }
    } catch {}
    const methods = ['HEAD', 'GET'];
    const uas = ['v2rayN/6.45', 'Clash', 'Surge', 'Shadowrocket'];
    let last = null;
    for (const cand of candidates) {
        for (const m of methods) {
            for (const ua of uas) {
                const res = await fetchSubscriptionUserInfo(cand, m, ua);
                last = { ...res, from: cand };
                if (res.info && (res.info.total || res.info.upload || res.info.download || typeof res.info.expire === 'number')) {
                    return { ...res, from: cand };
                }
            }
        }
    }
    return last;
}

// 质量评估
function evaluateQualityGate({ total, remain, daysLeft, nodeCount, unlimited = false, longterm = false }) {
    const totalOk = unlimited || (typeof total === 'number' && total >= 500 * 1024 * 1024 * 1024);
    const remainOk = unlimited || (typeof remain === 'number' && remain >= 300 * 1024 * 1024 * 1024);
    const daysOk = longterm || (typeof daysLeft === 'number' && daysLeft >= 16);
    const nodesOk = typeof nodeCount === 'number' && nodeCount >= 5 && nodeCount <= 100;
    return totalOk && remainOk && daysOk && nodesOk;
}

function evaluateQualityScore(signals) {
    let score = 0;
    if (signals.resetHint) score += 0.30;
    if (signals.jpkrBoth) score += 0.25;
    if (signals.ispQuality) score += 0.30;
    if (signals.spam) score -= 0.30;
    if (score < 0) score = 0; if (score > 1) score = 1;
    return score;
}

// 读取Top-N 高质量订阅
async function getTopQualitySubs(KV, n, secret) {
    try {
        // Cloudflare KV 不支持前缀列举；此处简化：维护一张索引（可后续增强为 list/scan）
        const idxJson = await KV.get('sub:index');
        const idx = idxJson ? JSON.parse(idxJson) : [];
        const now = Date.now();
        const items = [];
        for (const key of idx) {
            const val = await KV.get(key);
            if (!val) continue;
            try {
                const obj = JSON.parse(val);
                // 只取 accept 或最近30天
                if (obj && (obj.decision === 'accept' || (now - (obj.last_seen||0) <= 30*24*3600*1000))) {
                    const urlPlain = await decryptText(secret, obj.url_enc);
                    items.push({ ...obj, url_plain: urlPlain });
                }
            } catch {}
        }
        items.sort((a,b) => (b.quality_score||0) - (a.quality_score||0));
        return items.slice(0, n);
    } catch {
        return [];
    }
}

async function handleSubscriptionInfoCommand(bot_token, chatId, subUrl, moontvUrl, siteName, misubBase, misubAdminPassword, substoreBase, substoreName, KV = null) {
    try {
        // 先回执
        const pending = await sendSimpleMessage(bot_token, chatId, '<b>🔎 正在精确分析订阅信息...</b>');
        const pendingMessageId = pending?.result?.message_id;

        let count = null;
        let userInfo = null;
        let debug = null;

        const useMiSub = false;
        if (useMiSub && misubBase) {
            const base = misubBase.replace(/\/$/, '');
            // 若 MiSub 需要鉴权，先登录换取 Cookie
            let headers = { 'Content-Type': 'application/json' };
            try {
                if (misubAdminPassword) {
                    const loginResp = await fetch(`${base}/api/login`, { method: 'POST', headers, body: JSON.stringify({ password: misubAdminPassword }) });
                    if (loginResp.ok) {
                        const setCookie = loginResp.headers.get('set-cookie');
                        if (setCookie) {
                            headers = { ...headers, 'Cookie': setCookie };
                        }
                    }
                }
            } catch {}
            const [nodeCountResp, debugResp] = await Promise.all([
                fetch(`${base}/api/node_count`, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({ url: subUrl })
                }),
                fetch(`${base}/api/debug_subscription`, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({ url: subUrl, userAgent: 'v2rayN/6.45' })
                })
            ]);

            if (nodeCountResp && nodeCountResp.ok) {
                try { const j = await nodeCountResp.json(); count = j.count; userInfo = j.userInfo || null; } catch {}
            }
            if (debugResp && debugResp.ok) {
                try { debug = await debugResp.json(); } catch {}
            }
        }

        // 从 Sub-Store 拉节点（优先以 Sub-Store 为准）
        let nodeSampleNames = [];
        let protocols = [];
        let sampledCountries = [];
        let countryListAll = [];
        let allNodeNames = [];
        let protocolList = [];
        if (substoreBase && substoreName) {
            try {
                const urlParam = encodeURIComponent(subUrl);
                // 1) 先尝试 JSON，拿 name/type/数量
                const jsonUrl = `${substoreBase.replace(/\/$/, '')}/download/${encodeURIComponent(substoreName)}?url=${urlParam}&target=JSON&noCache=true`;
                let parsedFromJson = false;
                try {
                    const jr = await fetch(jsonUrl, { method: 'GET' });
                    if (jr.ok) {
                        const jtext = await jr.text();
                        const list = JSON.parse(jtext);
                        if (Array.isArray(list) && list.length > 0) {
                            const jsonNames = list.map(i => i?.name).filter(Boolean);
                            const jsonTypes = list.map(i => i?.type).filter(Boolean);
                            allNodeNames = jsonNames;
                            protocolList = jsonTypes.map(t => String(t).toUpperCase());
                            protocols = Array.from(new Set(protocolList));
                            if (jsonNames.length) nodeSampleNames = sampleArray(jsonNames, 3);
                            // 全量国家集合
                            const countriesFull = jsonNames.map(extractCountry).filter(Boolean);
                            countryListAll = countriesFull;
                            sampledCountries = Array.from(new Set(countriesFull));
                            count = list.length;
                            parsedFromJson = true;
                        }
                    }
                } catch {}
                // 2) 若 JSON 不可用，再退回 base64 行文本
                if (!parsedFromJson) {
                    const subUrlFull = `${substoreBase.replace(/\/$/, '')}/download/${encodeURIComponent(substoreName)}?url=${urlParam}&target=base64&ua=v2rayN/6.45&noCache=true`;
                    const resp = await fetch(subUrlFull, { method: 'GET' });
                    if (resp.ok) {
                        const b64 = await resp.text();
                        let content = '';
                        try { content = atob(b64.replace(/\s/g, '')); } catch { content = b64; }
                        const lines = content.replace(/\r\n/g, '\n').split('\n').map(s => s.trim()).filter(Boolean);
                        const nodeLines = lines.filter(line => /^(ss|ssr|vmess|vless|trojan|hysteria2?|hy|hy2|tuic|anytls|socks5):\/\//i.test(line));
                        const types = nodeLines.map(l => {
                            const m = l.match(/^(\w+):\/\//); return m ? String(m[1]).toUpperCase() : null;
                        }).filter(Boolean);
                        protocolList = types;
                        protocols = Array.from(new Set(types));
                        count = nodeLines.length;
                        let namesAll = nodeLines.map(decodeNodeName).map(n => n && n.trim()).filter(Boolean);
                        if (namesAll.length === 0) {
                            const reName = /#([^#\n\r]*)$/;
                            const fallback = nodeLines.map(l => {
                                const m = l.match(reName); return m ? decodeURIComponent(m[1]) : null;
                            }).filter(Boolean);
                            namesAll.push(...fallback);
                        }
                        allNodeNames = namesAll;
                        nodeSampleNames = sampleArray(namesAll, 3);
                        const countriesFull = namesAll.map(extractCountry).filter(Boolean);
                        countryListAll = countriesFull;
                        sampledCountries = Array.from(new Set(countriesFull));
                    }
                }
            } catch (e) {
                // 忽略 Sub-Store 错误，继续输出已获取的信息
            }
        }
        // 兜底：从候选地址读取 subscription-userinfo 响应头
        let uiDebug = null;
        try {
            if (!userInfo || !userInfo.total) {
                const res = await fetchUserInfoFromCandidates(subUrl, substoreBase, substoreName);
                uiDebug = res || null;
                if (res && res.info) userInfo = res.info;
            }
        } catch {}
        // 如果仍无任何信息，则提示失败
        if ((count === null && !userInfo)) {
            await sendSimpleMessage(bot_token, chatId, '❌ 查询失败：后端未返回有效数据，请稍后重试。');
            return new Response('OK');
        }

        // 构造展示
        let used = null, total = null, remain = null, expire = null;
        if (userInfo) {
            const upload = Number(userInfo.upload || 0);
            const download = Number(userInfo.download || 0);
            used = upload + download;
            total = Number(userInfo.total || 0);
            remain = total > 0 ? Math.max(0, total - used) : null;
            expire = userInfo.expire ? new Date(Number(userInfo.expire) * 1000) : null;
        }

        const percent = total && total > 0 ? (used / total) * 100 : null;
        const bar = percent !== null ? createProgressBar(percent) : null;

        const debugProtocols = parseProtocolsFrom(debug?.processedContent, debug?.validNodes);
        // 合并 Sub-Store 与 MiSub 提供的信息
        const mergedProtocols = Array.from(new Set([...(protocols || []), ...(debugProtocols || [])]));
        const sampleNames = (nodeSampleNames.length ? nodeSampleNames : (debug?.validNodes || []).map(decodeNodeName).filter(Boolean).slice(0, 3));
        const countries = sampledCountries.length ? sampledCountries : detectCountries(sampleNames);

        // TopN: 协议/地区
        const protoBase = protocolList.length ? protocolList.map(normalizeProtocolName) : mergedProtocols.map(normalizeProtocolName);
        const protocolTop = buildTopN(protoBase, 5);
        const countryTop = buildTopN(countryListAll, 5);

        const lines = [];
        lines.push(`<b>订阅链接</b>: <code>${subUrl}</code>`);
        if (used !== null && total !== null) {
            lines.push(`<b>流量详情</b>: ${formatBytes(used)} / ${formatBytes(total)}`);
            if (percent !== null) lines.push(`<b>使用进度</b>: ${bar} ${percent.toFixed(1)}%`);
            if (remain !== null) lines.push(`<b>剩余可用</b>: ${formatBytes(remain)}`);
        }
        if (expire) {
            const cn = expire.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
            const daysLeft = Math.ceil((expire.getTime() - Date.now()) / (24 * 3600 * 1000));
            lines.push(`<b>到期时间</b>: ${cn}（剩余 ${daysLeft} 天）`);
        } else if (userInfo && userInfo.expire === 0) {
            lines.push('<b>到期时间</b>: 长期有效');
        }
        if (typeof count === 'number') lines.push(`<b>节点总数</b>: ${count}`);
        if (mergedProtocols.length) lines.push(`<b>协议类型</b>: ${Array.from(new Set(mergedProtocols.map(normalizeProtocolName))).join(', ')}`);
        if (countries.length) lines.push(`<b>覆盖范围</b>: ${countries.join('、')}`);
        if (protocolTop.length) {
            lines.push('<b>协议占比</b>:');
            renderBarChart(protocolTop, protoBase.length).forEach(l => lines.push(l));
        }
        if (countryTop.length) {
            lines.push('<b>地区占比</b>:');
            renderBarChart(countryTop, countryListAll.length).forEach(l => lines.push(l));
        }
        if (sampleNames.length) {
            lines.push('<b>示例节点</b>:');
            sampleNames.filter(n => !/\|\s*0x\s*$/i.test(n)).forEach(n => lines.push(n));
        } else {
            lines.push('<b>示例节点</b>: 暂无可用名称');
        }

        // 调试：若仍无详细用量信息，附带一次尝试的 header 摘要，便于定位（可后续移除）
        if (uiDebug && (!userInfo || (!userInfo.upload && !userInfo.download && !userInfo.expire))) {
            const dbg = [];
            if (uiDebug.header) dbg.push(`header=${uiDebug.header}`);
            if (uiDebug.method) dbg.push(`method=${uiDebug.method}`);
            if (uiDebug.ua) dbg.push(`ua=${uiDebug.ua}`);
            if (uiDebug.from) dbg.push(`from=${uiDebug.from}`);
            if (dbg.length) lines.push(`<i>debug</i>: ${dbg.join(' | ')}`);
        }

        const finalText = lines.join('\n');

        // ===== 质量评分与KV存储（黑名单命中则跳过入库） =====
        try {
            const domain = getDomainFromUrl(subUrl);
            const adminSecret = siteName || 'MoonTV';
            const blKey = domain ? `bl:domain:${domain}` : null;
            const isBlacklisted = (KV && blKey) ? await KV.get(blKey) : null;

            if (!isBlacklisted && KV) {
                const unlimited = total === null || total === 0; // 视为未知或无限
                const longterm = !!(userInfo && userInfo.expire === 0);
                const gateOk = evaluateQualityGate({
                    total,
                    remain,
                    daysLeft: expire ? Math.ceil((expire.getTime() - Date.now()) / (24 * 3600 * 1000)) : null,
                    nodeCount: typeof count === 'number' ? count : null,
                    unlimited,
                    longterm
                });

                if (gateOk) {
                    const poolText = `${finalText}\n${(debug?.processedContent || '')}`;
                    // 结构化优先：重置/天数直接用 expire 推断
                    const daysLeftStruct = expire ? Math.ceil((expire.getTime() - Date.now()) / (24 * 3600 * 1000)) : (userInfo && userInfo.expire === 0 ? 9999 : null);
                    const resetHint = typeof daysLeftStruct === 'number' && daysLeftStruct >= 1;
                    // ISP/引流仅在节点名里匹配
                    const ispQuality = detectIspQualityKeywords((allNodeNames || []).join(' '));
                    const spam = detectSpamKeywords((allNodeNames || []).join(' '));
                    // JP+KR：节点名 + 覆盖范围
                    const jpkrBoth = detectHasJapanAndKorea(allNodeNames || [], countries || []);
                    const score = evaluateQualityScore({ resetHint, ispQuality, spam, jpkrBoth });

                    const urlHash = await fingerprint(adminSecret, subUrl);
                    const encUrl = await encryptText(adminSecret, subUrl);
                    const summary = {
                        provider_domain: domain,
                        url_hash: urlHash,
                        url_enc: encUrl,
                        created_at: Date.now(),
                        last_seen: Date.now(),
                        total, remain, used,
                        days_left: expire ? Math.ceil((expire.getTime() - Date.now()) / (24 * 3600 * 1000)) : (userInfo && userInfo.expire === 0 ? 9999 : null),
                        node_count: count,
                        jpkr_both: jpkrBoth,
                        reset_hint: resetHint,
                        isp_quality: ispQuality,
                        spam,
                        quality_score: score,
                        reasons: {
                            reset_hint: resetHint,
                            jpkr_both: jpkrBoth,
                            isp_quality: ispQuality,
                            spam
                        },
                        decision: score >= 0.5 ? 'accept' : 'reject'
                    };
                    const key = `sub:${urlHash}`;
                    const ttl = summary.decision === 'accept' ? 30 * 24 * 3600 : 24 * 3600;
                    await KV.put(key, JSON.stringify(summary), { expirationTtl: ttl });
                    // 维护索引，便于 Top-N 浏览（简易实现）
                    try {
                        const idxJson = await KV.get('sub:index');
                        const idx = idxJson ? JSON.parse(idxJson) : [];
                        if (!idx.includes(key)) {
                            idx.unshift(key);
                            // 最多保留 500 条索引
                            await KV.put('sub:index', JSON.stringify(idx.slice(0, 500)), { expirationTtl: 60 * 24 * 3600 });
                        }
                    } catch {}
                }
            }
        } catch (qe) {
            console.log('质量评分存储异常:', qe?.message || qe);
        }
        // 默认只附带“转换为客户端订阅”折叠按钮，用户需要时再展开
        let replyMarkup = null;
        if (substoreBase && substoreName) {
            replyMarkup = buildCollapsedConvertKeyboard();
            // 将原始订阅缓存到KV，供回调时读取（避免从文本解析失败）
            try {
                if (KV && pendingMessageId) {
                    await KV.put(`convert:${chatId}:${pendingMessageId}`, subUrl, { expirationTtl: 3600 });
                }
            } catch {}
        }
        if (pendingMessageId) {
            await editMessage(bot_token, chatId, pendingMessageId, finalText, replyMarkup);
        } else {
            await sendSimpleMessage(bot_token, chatId, finalText);
        }
        return new Response('OK');
    } catch (e) {
        await sendSimpleMessage(bot_token, chatId, `❌ 查询失败：${e.message || '未知错误'}`);
        return new Response('OK');
    }
}

// 直连解析函数已移除（按用户要求仅使用 MiSub 数据）

// 获取最新APP下载页信息
async function getLatestAppRelease() {
    try {
        const response = await fetch('https://api.github.com/repos/MoonTechLab/Selene/releases/latest', {
            headers: {
                'User-Agent': USER_AGENT
            }
        });

        if (!response.ok) {
            throw new Error(`GitHub API请求失败: HTTP ${response.status}`);
        }

        const releaseData = await response.json();
        
        return {
            version: releaseData.tag_name,
            downloadUrl: releaseData.html_url
        };
    } catch (error) {
        console.error('获取最新APP版本失败:', error);
        return null;
    }
}

export default {
    async fetch(request, env, ctx) {
        const moontvUrl = extractBaseUrl(env.MOONTVURL || "https://moontv.com/");
        const apiUrl = extractBaseUrl(env.APIURL || moontvUrl);
        const username = env.USERNAME || "admin";
        const password = env.PASSWORD || "admin_password";
        const token = env.TOKEN || "token";
        const bot_token = env.BOT_TOKEN || "8226743743:AAHfrc09vW8cxKHyU0q0YKPuCXrW1ICWdU0";
        const GROUP_ID = env.GROUP_ID || "-1002563172210";
        const misubBase = env.MISUB_BASE || null; // MiSub 后端地址
        const misubAdminPassword = env.MISUB_ADMIN_PASSWORD || null; // MiSub 管理密码，用于获取 Cookie
        const substoreBase = env.SUBSTORE_BASE || null; // Sub-Store 后端地址
        const substoreName = env.SUBSTORE_NAME || 'relay'; // Sub-Store 订阅名
        const siteName = env.NEXT_PUBLIC_SITE_NAME || null;
        const ADMIN_TG_ID = env.ADMIN_TG_ID ? Number(env.ADMIN_TG_ID) : null; // 仅管理员可用命令
        const ADMIN_TOKEN = env.ADMIN_TOKEN || token; // 受保护HTTP接口的令牌
        const url = new URL(request.url);
        const PUBLIC_BASE = env.PUBLIC_BASE || `${url.protocol}//${url.host}`;
        const path = url.pathname;

        // 处理 Webhook 初始化路径
        if (path.includes(`/${token}`)) {
            return await handleWebhookInit(bot_token, request.url, token);
        }

        // 处理检测路径
        if (path === '/check' && request.method === 'GET') {
            const urlParams = new URLSearchParams(url.search);
            const checkToken = urlParams.get('token');

            if (checkToken === token) {
                return await handleCheckEndpoint(apiUrl, username, password, env.KV);
            } else {
                return new Response("Forbidden", { status: 403 });
            }
        }

        // H5 中转：/open?app=&scheme=&fallback=
        if (path === '/open' && request.method === 'GET') {
            return await handleOpenRedirect(url);
        }

        // 管理员：Top-N 高质量订阅（受保护）
        if (path === '/quality/top' && request.method === 'GET') {
            const params = new URLSearchParams(url.search);
            const t = params.get('token');
            const n = Math.min(20, Math.max(1, Number(params.get('n') || '10')));
            if (t !== ADMIN_TOKEN) return new Response('Forbidden', { status: 403 });
            const list = await getTopQualitySubs(env.KV, n, siteName || 'MoonTV');
            return new Response(JSON.stringify({ ok: true, top: list }, null, 2), { headers: { 'Content-Type': 'application/json' } });
        }

        // 处理 Telegram Webhook
        if (request.method === 'POST') {
            return await handleTelegramWebhook(request, bot_token, GROUP_ID, apiUrl, moontvUrl, username, password, env.KV, siteName, misubBase, misubAdminPassword, substoreBase, substoreName, ADMIN_TG_ID, PUBLIC_BASE);
        }

        // 默认返回404错误页面（伪装）
        return new Response("Not Found", { status: 404 });
    },
    // 每日定时任务（需在Cloudflare中配置Cron触发）
    async scheduled(event, env, ctx) {
        try {
            const adminId = env.ADMIN_TG_ID ? Number(env.ADMIN_TG_ID) : null;
            if (!adminId || !env.BOT_TOKEN) return;
            const top = await getTopQualitySubs(env.KV, 10, env.NEXT_PUBLIC_SITE_NAME || 'MoonTV');
            if (!top || top.length === 0) return;
            const lines = [];
            lines.push(`📊 高质量订阅 Top ${top.length}`);
            top.forEach((s, idx) => {
                lines.push(`${idx + 1}. ${s.provider_domain} 评分:${(s.quality_score||0).toFixed(2)} 节点:${s.node_count}`);
            });
            lines.push('\n如需查看原始URL，请使用 /quality top 命令或管理接口。');
            await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: adminId, text: lines.join('\n') })
            });
        } catch (e) {
            console.log('scheduled error', e?.message || e);
        }
    }
};

// /open 中转：通过 https 触发 app scheme，失败回退到 fallback
async function handleOpenRedirect(url) {
    const params = new URLSearchParams(url.search);
    const scheme = params.get('scheme');
    const fallback = params.get('fallback');
    const app = params.get('app') || 'App';
    const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>打开 ${app}</title>
<style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;line-height:1.45;padding:20px}a{color:#1677ff;text-decoration:none}</style>
</head><body>
<h3>正在打开 ${app}…</h3>
<p>若未自动跳转，请 <a id="open" href="${scheme||''}">点此打开</a> 或 <a id="fb" href="${fallback||'#'}">使用备用链接</a>。</p>
<script>
  (function(){
    try { if (${JSON.stringify(!!scheme)}) window.location.href = ${JSON.stringify('') } || '${scheme}'; } catch(e) {}
    setTimeout(function(){ try{ window.location.href = '${fallback||'#'}'; }catch(e){} }, 1500);
  })();
</script>
</body></html>`;
    return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}

// 处理检测端点
async function handleCheckEndpoint(apiUrl, username, password, KV) {
    const checkResult = {
        timestamp: new Date().toISOString(),
        moontvApi: {
            url: apiUrl,
            status: 'unknown',
            error: null,
            responseTime: null
        },
        cookieStatus: {
            exists: false,
            valid: false,
            error: null
        },
        configApi: {
            accessible: false,
            userCount: 0,
            error: null
        },
        errors: []
    };

    let startTime = Date.now();

    try {
        // 测试登录API
        console.log('Testing MoonTV API connection...');

        const loginResponse = await fetch(`${apiUrl.replace(/\/$/, '')}/api/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': USER_AGENT
            },
            body: JSON.stringify({
                username: username,
                password: password
            })
        });

        checkResult.moontvApi.responseTime = Date.now() - startTime;

        if (!loginResponse.ok) {
            checkResult.moontvApi.status = 'error';
            checkResult.moontvApi.error = `API请求失败: HTTP ${loginResponse.status}`;
            checkResult.errors.push(`MoonTV API连接失败: HTTP ${loginResponse.status}`);
        } else {
            const loginResult = await loginResponse.json();

            if (loginResult.ok) {
                checkResult.moontvApi.status = 'connected';
                console.log('MoonTV API连接成功');

                // 测试Cookie功能
                try {
                    const cookie = await getCookie(apiUrl, username, password, KV);
                    checkResult.cookieStatus.exists = true;
                    checkResult.cookieStatus.valid = true;
                    console.log('Cookie获取成功');

                    // 测试配置API
                    try {
                        const cookie = await getCookie(apiUrl, username, password, KV);
                        console.log('准备调用配置API，使用Cookie:', cookie);

                        const configResponse = await fetch(`${apiUrl.replace(/\/$/, '')}/api/admin/config`, {
                            method: 'GET',
                            headers: {
                                'Cookie': cookie,
                                'User-Agent': USER_AGENT
                            }
                        });

                        console.log('配置API响应状态:', configResponse.status);
                        console.log('配置API响应头:', Object.fromEntries(configResponse.headers.entries()));

                        if (configResponse.ok) {
                            const configResult = await configResponse.json();
                            checkResult.configApi.accessible = true;

                            if (configResult.Config && configResult.Config.UserConfig && configResult.Config.UserConfig.Users) {
                                checkResult.configApi.userCount = configResult.Config.UserConfig.Users.length;
                                console.log(`配置API访问成功，当前用户数: ${checkResult.configApi.userCount}`);
                            }
                        } else {
                            const errorText = await configResponse.text();
                            console.log('配置API错误响应内容:', errorText);
                            checkResult.configApi.error = `配置API访问失败: HTTP ${configResponse.status}`;
                            checkResult.errors.push(checkResult.configApi.error);
                        }
                    } catch (configError) {
                        checkResult.configApi.error = configError.message;
                        checkResult.errors.push(`配置API测试失败: ${configError.message}`);
                    }

                } catch (cookieError) {
                    checkResult.cookieStatus.error = cookieError.message;
                    checkResult.errors.push(`Cookie获取失败: ${cookieError.message}`);
                }
            } else {
                checkResult.moontvApi.status = 'auth_error';
                checkResult.moontvApi.error = '登录认证失败';
                checkResult.errors.push('用户名或密码错误');
            }
        }

    } catch (networkError) {
        checkResult.moontvApi.status = 'network_error';
        checkResult.moontvApi.responseTime = Date.now() - startTime;
        checkResult.moontvApi.error = networkError.message;
        checkResult.errors.push(`网络错误: ${networkError.message}`);

        // 分析可能的网络问题
        if (networkError.message.includes('fetch')) {
            checkResult.errors.push('可能的原因: 1) MoonTV URL配置错误 2) 网络连接问题 3) 服务器不可达');
        }
        if (networkError.message.includes('timeout')) {
            checkResult.errors.push('连接超时，请检查MoonTV服务状态');
        }
    }

    // 添加诊断建议
    const diagnostics = [];

    if (checkResult.moontvApi.status === 'error' || checkResult.moontvApi.status === 'network_error') {
        diagnostics.push('请检查MOONTVURL环境变量是否正确配置');
        diagnostics.push('请确认MoonTV服务是否正常运行');
        diagnostics.push('请检查网络连接是否正常');
    }

    if (checkResult.moontvApi.status === 'auth_error') {
        diagnostics.push('请检查USERNAME和PASSWORD环境变量是否正确');
        diagnostics.push('请确认用户具有管理员权限');
    }

    if (!checkResult.cookieStatus.valid && checkResult.moontvApi.status === 'connected') {
        diagnostics.push('API连接正常但Cookie获取失败，可能存在权限问题');
    }

    if (!checkResult.configApi.accessible && checkResult.cookieStatus.valid) {
        diagnostics.push('Cookie获取成功但配置API访问失败，请检查管理员权限');
    }

    if (checkResult.moontvApi.responseTime && checkResult.moontvApi.responseTime > 5000) {
        diagnostics.push('API响应时间较长，可能存在网络延迟问题');
    }

    checkResult.diagnostics = diagnostics;
    checkResult.summary = {
        apiOk: checkResult.moontvApi.status === 'connected',
        cookieOk: checkResult.cookieStatus.valid,
        configOk: checkResult.configApi.accessible,
        overallStatus: checkResult.moontvApi.status === 'connected' &&
            checkResult.cookieStatus.valid &&
            checkResult.configApi.accessible ? 'healthy' : 'unhealthy'
    };

    return new Response(JSON.stringify(checkResult, null, 2), {
        headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache'
        },
    });
}

// 初始化 Webhook
async function handleWebhookInit(bot_token, workerUrl, token) {
    try {
        const webhookUrl = workerUrl.replace(`/${token}`, '');

        // 设置 webhook
        const setWebhookResponse = await fetch(`https://api.telegram.org/bot${bot_token}/setWebhook`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                url: webhookUrl,
            }),
        });

        const setWebhookResult = await setWebhookResponse.json();

        // 设置机器人命令
        const setCommandsResponse = await fetch(`https://api.telegram.org/bot${bot_token}/setMyCommands`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                commands: [
                    { command: "state", description: "查看站点状态信息" },
                    { command: "start", description: "注册/查看用户信息" }
                ]
            }),
        });
        const setCommandsResult = await setCommandsResponse.json();

        return new Response(JSON.stringify({
            webhook: setWebhookResult,
            commands: setCommandsResult,
            message: "Bot initialized successfully"
        }, null, 2), {
            headers: { 'Content-Type': 'application/json' },
        });
    } catch (error) {
        return new Response(JSON.stringify({
            error: "Failed to initialize bot",
            message: error.message
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
}

// 检查命令是否是发给当前机器人的
async function isCommandForThisBot(text, bot_token) {
    // 如果命令中没有@，说明是私聊或者群组中的通用命令
    if (!text.includes('@')) {
        return { isForThisBot: true, normalizedText: text };
    }

    // 提取@后面的机器人用户名
    const atMatch = text.match(/@(\w+)/);
    if (!atMatch) {
        return { isForThisBot: true, normalizedText: text };
    }

    const mentionedBotUsername = atMatch[1];

    try {
        // 获取当前机器人的信息
        const botInfoResponse = await fetch(`https://api.telegram.org/bot${bot_token}/getMe`);
        if (!botInfoResponse.ok) {
            // 如果无法获取机器人信息，为了安全起见，只处理不带@的命令
            return { isForThisBot: !text.includes('@'), normalizedText: text.replace(/@\w+/g, '') };
        }

        const botInfo = await botInfoResponse.json();
        const currentBotUsername = botInfo.result.username;

        // 检查是否是发给当前机器人的命令
        const isForThisBot = mentionedBotUsername === currentBotUsername;
        const normalizedText = isForThisBot ? text.replace(/@\w+/g, '') : text;

        return { isForThisBot, normalizedText };
    } catch (error) {
        console.error('Error checking bot info:', error);
        // 出错时为了安全起见，只处理不带@的命令
        return { isForThisBot: !text.includes('@'), normalizedText: text.replace(/@\w+/g, '') };
    }
}

// 处理 Telegram Webhook
async function handleTelegramWebhook(request, bot_token, GROUP_ID, apiUrl, moontvUrl, username, password, KV, siteName, misubBase, misubAdminPassword, substoreBase, substoreName, ADMIN_TG_ID = null, PUBLIC_BASE = null) {
    try {
        const update = await request.json();

        // 回调按钮处理：展开/收起客户端转换按钮
        if (update.callback_query) {
            const cq = update.callback_query;
            const data = cq.data || '';
            const chatId = cq.message?.chat?.id;
            const messageId = cq.message?.message_id;
            if (!chatId || !messageId) {
                return new Response('OK');
            }

            if (data === 'ask_convert') {
                // 展示二次确认
                const confirmKb = { inline_keyboard: [[{ text: '✅ 确认生成', callback_data: 'confirm_convert' }, { text: '❌ 取消', callback_data: 'collapse_convert' }]] };
                await editMessageMarkup(bot_token, chatId, messageId, confirmKb.inline_keyboard);
                await answerCallback(bot_token, cq.id, '请确认是否生成转换按钮');
                return new Response('OK');
            }

            if (data === 'confirm_convert' || data === 'expand_convert') {
                // 防抖：避免重复点击
                try {
                    if (KV) {
                        const lockKey = `convert:lock:${chatId}:${messageId}`;
                        const locked = await KV.get(lockKey);
                        if (locked) {
                            await answerCallback(bot_token, cq.id, '正在处理，请稍候…');
                            return new Response('OK');
                        }
                        await KV.put(lockKey, '1', { expirationTtl: 60 });
                    }
                } catch {}
                // 立即提示处理中并更新按钮文案
                await answerCallback(bot_token, cq.id, '⏳ 正在生成，请稍候…');
                try {
                    const processingKb = buildProcessingKeyboard();
                    await editMessageMarkup(bot_token, chatId, messageId, processingKb.inline_keyboard);
                } catch {}
                const text = cq.message?.text || '';
                let originalSubUrl = null;
                try {
                    const m = text.match(/订阅链接[\s\S]*?<code>([^<]+)<\/code>/);
                    if (m) originalSubUrl = m[1];
                } catch {}
                if (!originalSubUrl && KV) {
                    const key = `convert:${chatId}:${messageId}`;
                    try { originalSubUrl = await KV.get(key); } catch {}
                }
                if (originalSubUrl && substoreBase && substoreName) {
                    // 发送单独的新消息：包含各客户端的中转https链接
                    const deepLinksText = buildOpenPageSection(PUBLIC_BASE, substoreBase, substoreName, originalSubUrl, extractHostname(originalSubUrl) || '订阅');
                    if (deepLinksText) {
                        await sendSimpleMessage(bot_token, chatId, deepLinksText);
                    }
                    // 移除原消息的内联按钮
                    await editMessageMarkup(bot_token, chatId, messageId, []);
                }
                // 清理一次性临时键与锁
                try {
                    if (KV) {
                        await KV.delete(`convert:${chatId}:${messageId}`);
                        await KV.delete(`convert:lock:${chatId}:${messageId}`);
                    }
                } catch {}
                await answerCallback(bot_token, cq.id, '已发送一键导入链接');
                return new Response('OK');
            }

            if (data === 'collapse_convert') {
                const markup = buildCollapsedConvertKeyboard();
                await editMessageMarkup(bot_token, chatId, messageId, markup.inline_keyboard);
                // 清理一次性临时键
                try {
                    if (KV) {
                        await KV.delete(`convert:${chatId}:${messageId}`);
                        await KV.delete(`convert:lock:${chatId}:${messageId}`);
                    }
                } catch {}
                await answerCallback(bot_token, cq.id);
                return new Response('OK');
            }

            // 占位按钮（处理中）
            if (data === 'noop') {
                await answerCallback(bot_token, cq.id, '正在处理，请稍候…');
                return new Response('OK');
            }

            return new Response('OK');
        }

        if (update.message && update.message.text) {
            const message = update.message;
            const userId = message.from.id;
            const chatId = message.chat.id;
            const text = message.text;
            // 预先规范化文本，供后续管理员命令与普通命令共用
            const { isForThisBot, normalizedText } = await isCommandForThisBot(text, bot_token);
            // 管理员私有命令：黑名单与Top-N
            if (ADMIN_TG_ID && userId === ADMIN_TG_ID) {
                if (normalizedText.startsWith('/ban ')) {
                    const domain = normalizedText.substring(5).trim();
                    if (domain) {
                        await KV.put(`bl:domain:${domain}`, '1', { expirationTtl: 365*24*3600 });
                        await sendSimpleMessage(bot_token, chatId, `✅ 已加入域名黑名单：<code>${domain}</code>`);
                        return new Response('OK');
                    }
                }
                if (normalizedText.startsWith('/unban ')) {
                    const domain = normalizedText.substring(7).trim();
                    if (domain) {
                        await KV.delete(`bl:domain:${domain}`);
                        await sendSimpleMessage(bot_token, chatId, `✅ 已移除域名黑名单：<code>${domain}</code>`);
                        return new Response('OK');
                    }
                }
                if (normalizedText.startsWith('/quality top')) {
                    const parts = normalizedText.split(' ').filter(Boolean);
                    const n = parts.length >= 3 ? Math.min(20, Math.max(1, Number(parts[2]) || 10)) : 10;
                    const list = await getTopQualitySubs(KV, n, siteName || 'MoonTV');
                    if (!list || list.length === 0) {
                        await sendSimpleMessage(bot_token, chatId, '暂无高质量订阅记录');
                        return new Response('OK');
                    }
                    const lines = [];
                    lines.push(`📊 高质量订阅 Top ${list.length}`);
                    list.forEach((s, idx) => {
                        const rs = s.reasons || {};
                        const reasonText = [
                            rs.reset_hint ? '重置✓' : null,
                            rs.jpkr_both ? '日+韩✓' : null,
                            rs.isp_quality ? '家宽/专线✓' : null,
                            rs.spam ? '引流×' : null
                        ].filter(Boolean).join('，');
                        lines.push(`${idx + 1}. ${s.provider_domain} 评分:${(s.quality_score||0).toFixed(2)} 节点:${s.node_count}${reasonText? ' ｜'+reasonText: ''}`);
                        lines.push(`URL: ${s.url_plain || '(加密解密失败)'}`);
                    });
                    await sendSimpleMessage(bot_token, chatId, lines.join('\n'));
                    return new Response('OK');
                }
                if (normalizedText.startsWith('/usage')) {
                    const parts = normalizedText.split(' ').filter(Boolean);
                    let offset = 0;
                    if (parts.length >= 2) {
                        const a = parts[1].toLowerCase();
                        if (a === 'y' || a === 'yday' || a === 'yesterday') offset = -1;
                        else { const n = parseInt(a, 10); if (!isNaN(n)) offset = n; }
                    }
                    const stats = await getDailyUsage(KV, offset);
                    const entries = Object.entries(stats.counts).sort((a,b)=> (b[1]||0)-(a[1]||0)).slice(0,5);
                    const topLines = entries.map(([uid,c],i)=>{
                        const name = stats.names[uid] || uid;
                        const link = `<a href="tg://user?id=${uid}">${name}</a>`;
                        return `${i+1}. ${link}（${uid}）×${c}`;
                    });
                    const head = `📈 使用统计 ${getDateKey(offset)}\n唯一用户: ${stats.unique}｜总查询: ${stats.total}`;
                    const body = topLines.length? ['Top 5:', ...topLines].join('\n') : 'Top 5: 暂无';
                    await sendSimpleMessage(bot_token, chatId, `${head}\n${body}`);
                    return new Response('OK');
                }
            }

            // 如果命令不是发给当前机器人的，直接忽略
            if (!isForThisBot) {
                return new Response('OK');
            }

            // 处理 /start 命令
            if (normalizedText === '/start' || normalizedText.startsWith('/start ')) {
                return await handleStartCommand(bot_token, userId, chatId, message.chat.type, GROUP_ID, apiUrl, moontvUrl, username, password, KV, siteName);
            }

            // 处理 /pwd 命令
            if (normalizedText.startsWith('/pwd')) {
                if (normalizedText === '/pwd' || normalizedText.trim() === '/pwd') {
                    // 用户只输入了 /pwd 没有提供密码
                    await sendMessage(bot_token, chatId, "❌ 请输入要修改的新密码\n\n💡 使用方法：<code>/pwd 新密码</code>\n📝 示例：<code>/pwd 12345678</code>\n\n这样就会将密码改为 12345678", moontvUrl, siteName);
                    return new Response('OK');
                } else if (normalizedText.startsWith('/pwd ')) {
                    const newPassword = normalizedText.substring(5).trim();
                    return await handlePasswordCommand(bot_token, userId, chatId, message.chat.type, GROUP_ID, newPassword, apiUrl, moontvUrl, username, password, KV, siteName);
                }
            }

            // 处理 /state 命令
            if (normalizedText === '/state') {
                return await handleStateCommand(bot_token, userId, chatId, GROUP_ID, apiUrl, moontvUrl, username, password, KV, siteName);
            }

            // 订阅查询：无需权限，检测文本中是否包含 http/https 链接
            const urlMatch = normalizedText.match(/https?:\/\/[^\s]+/i);
            if (urlMatch) {
                const subUrl = urlMatch[0];
                // 记录今日使用：以 message.from.id 作为用户唯一键
                try {
                    const name = message.from.username ? `@${message.from.username}` : `${message.from.first_name||''} ${message.from.last_name||''}`.trim();
                    await recordDailyUsage(KV, userId, name);
                } catch {}
                return await handleSubscriptionInfoCommand(bot_token, chatId, subUrl, moontvUrl, siteName, misubBase, misubAdminPassword, substoreBase, substoreName, KV);
            }
        }

        return new Response('OK');
    } catch (error) {
        console.error('Error handling webhook:', error);
        return new Response('Error', { status: 500 });
    }
}

// 处理 /start 命令
async function handleStartCommand(bot_token, userId, chatId, chatType, GROUP_ID, apiUrl, moontvUrl, username, password, KV, siteName) {
    try {
        // 检查是否在群聊或超级群组中
        if (chatType === 'group' || chatType === 'supergroup') {
            // 在群聊中，只提示用户私聊机器人
            const botInfo = await getBotInfo(bot_token);
            const botUsername = botInfo ? botInfo.username : 'bot';
            
            await sendMessage(bot_token, chatId, `🔐 为了保护您的账户安全，请私聊机器人进行注册\n\n💬 点击 @${botUsername}\n\n⚠️ 在群聊中注册会暴露您的密码信息`, moontvUrl, siteName);
            return new Response('OK');
        }

        // 以下是原来的私聊处理逻辑
        // 检查用户是否在群组中
        const isInGroup = await checkUserInGroup(bot_token, GROUP_ID, userId);

        if (!isInGroup) {
            const groupName = await getGroupName(bot_token, GROUP_ID);
            await sendMessage(bot_token, chatId, `⚠️ 当前用户无注册权限，只允许 <b>${groupName}</b> 群组内部人员注册使用。\n\n请先加入群组：<a href="https://t.me/omni_stars">@omni_stars</a>`, moontvUrl, siteName);
            return new Response('OK');
        }

        // 获取站点名称（如果环境变量没有设置，则从API获取）
        let actualSiteName = siteName;
        if (!actualSiteName) {
            try {
                const cookie = await getCookie(apiUrl, username, password, KV);
                const configResponse = await fetch(`${apiUrl.replace(/\/$/, '')}/api/admin/config`, {
                    method: 'GET',
                    headers: {
                        'Cookie': cookie,
                        'User-Agent': USER_AGENT
                    }
                });

                if (configResponse.ok) {
                    const configResult = await configResponse.json();
                    actualSiteName = configResult.Config?.SiteConfig?.SiteName || 'MoonTV';
                }
            } catch (error) {
                console.log('获取API站点名称失败，使用默认值:', error.message);
                actualSiteName = 'MoonTV';
            }
        }

        // 检查用户是否已注册（通过API查询）
        const userExists = await checkUserExists(apiUrl, username, password, KV, userId.toString());

        // 获取最新APP版本信息
        const appInfo = await getLatestAppRelease();

        let responseMessage;

        if (!userExists) {
            // 用户未注册，创建新账户
            const initialPassword = await generateInitialPassword(userId);

            // 先发送"正在注册"的消息
            await sendMessage(bot_token, chatId, "⏳ 正在为您注册账户，请稍等...", moontvUrl, actualSiteName);

            // 尝试注册用户，最多重试3次
            let registrationSuccess = false;
            let lastError = null;
            const maxRetries = 3;

            for (let attempt = 1; attempt <= maxRetries; attempt++) {
                try {
                    console.log(`第${attempt}次尝试注册用户: ${userId}`);
                    
                    // 获取cookie并调用API添加用户
                    const cookie = await getCookie(apiUrl, username, password, KV);

                    const addUserResponse = await fetch(`${apiUrl.replace(/\/$/, '')}/api/admin/user`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Cookie': cookie,
                            'User-Agent': USER_AGENT
                        },
                        body: JSON.stringify({
                            targetUsername: userId.toString(),
                            targetPassword: initialPassword,
                            action: 'add'
                        })
                    });

                    if (!addUserResponse.ok) {
                        throw new Error(`添加用户API失败: HTTP ${addUserResponse.status}`);
                    }

                    const addResult = await addUserResponse.json();
                    if (!addResult.ok) {
                        throw new Error('添加用户API返回失败状态');
                    }

                    // 等待一秒让后端处理完成
                    await new Promise(resolve => setTimeout(resolve, 1000));

                    // 验证用户是否真正创建成功
                    console.log(`验证第${attempt}次注册是否成功...`);
                    const userCreated = await checkUserExists(apiUrl, username, password, KV, userId.toString());
                    
                    if (userCreated) {
                        console.log(`第${attempt}次注册验证成功`);
                        registrationSuccess = true;
                        break;
                    } else {
                        console.log(`第${attempt}次注册验证失败，用户未出现在列表中`);
                        throw new Error(`第${attempt}次注册后验证失败，用户未出现在系统中`);
                    }

                } catch (apiError) {
                    console.error(`第${attempt}次注册尝试失败:`, apiError);
                    lastError = apiError;
                    
                    // 如果不是最后一次尝试，等待2秒后重试
                    if (attempt < maxRetries) {
                        console.log(`等待2秒后进行第${attempt + 1}次重试...`);
                        await new Promise(resolve => setTimeout(resolve, 2000));
                    }
                }
            }

            if (registrationSuccess) {
                // 注册成功
                responseMessage = `✅ 注册成功！\n\n🌐 <b>服务器：</b><code>${moontvUrl}</code>\n🆔 <b>用户名：</b><code>${userId}</code> (您的TG数字ID)\n🔑 <b>访问密码：</b><code>${initialPassword}</code>\n\n💡 使用 <code>/pwd 新密码</code> 可以修改密码\n\n⚠️ 请妥善保存密码，忘记密码可通过修改密码命令重置`;
            } else {
                // 3次尝试后仍然失败
                console.error(`经过${maxRetries}次尝试后注册仍然失败，最后错误:`, lastError);
                await sendMessage(bot_token, chatId, `❌ 注册失败\n\n经过${maxRetries}次尝试后仍无法成功注册账户。\n\n请联系管理员排查问题。\n\n错误信息: ${lastError?.message || '未知错误'}`, moontvUrl, actualSiteName, appInfo);
                return new Response('OK');
            }
        } else {
            // 用户已存在，显示当前信息
            responseMessage = `ℹ️ 你已注册过账户\n\n🌐 <b>服务器：</b><code>${moontvUrl}</code>\n🆔 <b>用户名：</b><code>${userId}</code> (您的TG数字ID)\n\n💡 使用 <code>/pwd 新密码</code> 可以修改密码\n\n⚠️ 如忘记密码，可直接通过修改密码命令重置`;
        }

        await sendMessage(bot_token, chatId, responseMessage, moontvUrl, actualSiteName, appInfo);
        return new Response('OK');
    } catch (error) {
        console.error('Error in start command:', error);
        await sendMessage(bot_token, chatId, "❌ 操作失败，请稍后再试。", moontvUrl, siteName);
        return new Response('OK');
    }
}

// 处理 /state 命令
async function handleStateCommand(bot_token, userId, chatId, GROUP_ID, apiUrl, moontvUrl, username, password, KV, siteName) {
    try {
        // 检查用户是否在群组中
        const isInGroup = await checkUserInGroup(bot_token, GROUP_ID, userId);

        if (!isInGroup) {
            const groupName = await getGroupName(bot_token, GROUP_ID);
            await sendMessage(bot_token, chatId, `⚠️ 当前用户无权限，只允许 <b>${groupName}</b> 群组内部人员使用。`, moontvUrl, siteName);
            return new Response('OK');
        }

        // 发送加载中的消息
        //await sendMessage(bot_token, chatId, "📊 正在获取站点状态信息...", moontvUrl, siteName);

        // 获取配置信息
        try {
            const cookie = await getCookie(apiUrl, username, password, KV);

            const apiStartTime = Date.now();
            const configResponse = await fetch(`${apiUrl.replace(/\/$/, '')}/api/admin/config`, {
                method: 'GET',
                headers: {
                    'Cookie': cookie,
                    'User-Agent': USER_AGENT
                }
            });

            if (!configResponse.ok) {
                throw new Error(`配置API访问失败: HTTP ${configResponse.status}`);
            }

            const configResult = await configResponse.json();
            const apiResponseTime = Date.now() - apiStartTime;

            if (!configResult.Config) {
                throw new Error('配置数据获取失败');
            }

            // 统计数据
            const userCount = configResult.Config.UserConfig?.Users?.length || 0;
            const sourceCount = configResult.Config.SourceConfig?.length || 0;
            const liveCount = configResult.Config.LiveConfig?.length || 0;
            const configSiteName = siteName || configResult.Config.SiteConfig?.SiteName || 'MoonTV';

            console.log('DEBUG: siteName from env:', siteName);
            console.log('DEBUG: SiteName from API:', configResult.Config.SiteConfig?.SiteName);
            console.log('DEBUG: Final configSiteName:', configSiteName);

            // 计算活跃的视频源和直播源数量
            const activeSourceCount = configResult.Config.SourceConfig?.filter(source => !source.disabled).length || 0;
            const activeLiveCount = configResult.Config.LiveConfig?.filter(live => !live.disabled).length || 0;

            // 获取配置更新时间
            const lastCheck = configResult.Config.ConfigSubscribtion?.LastCheck;
            const lastUpdateTime = lastCheck ? new Date(lastCheck).toLocaleString('zh-CN', {
                timeZone: 'Asia/Shanghai',
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            }) : '未知';

            // 测试 moontvUrl 延迟
            let moontvResponseTime = null;
            try {
                const moontvStartTime = Date.now();
                const moontvResponse = await fetch(moontvUrl, {
                    method: 'GET',
                    headers: {
                        'User-Agent': USER_AGENT
                    }
                });
                moontvResponseTime = Date.now() - moontvStartTime;
            } catch (error) {
                console.error('测试 moontvUrl 延迟失败:', error);
            }

            // 构建状态消息
            const stateMessage = `🎬 <b>${configSiteName}</b> 站点状态

📊 <b>核心统计</b>
👥 总用户数: <b>${userCount}</b> 人
🎞️ 视 频 源: <b>${activeSourceCount}</b>/<b>${sourceCount}</b> 个
📺 直 播 源: <b>${activeLiveCount}</b>/<b>${liveCount}</b> 个

⚙️ <b>系统信息</b>
🔄 配置更新: ${lastUpdateTime}
🎯 自动更新: ${configResult.Config.ConfigSubscribtion?.AutoUpdate ? '✅ 已启用' : '❌ 已禁用'}
🕐 缓存时间: <b>${configResult.Config.SiteConfig?.SiteInterfaceCacheTime || 7200}</b> 秒
🔍 搜索页数: 最大 <b>${configResult.Config.SiteConfig?.SearchDownstreamMaxPage || 5}</b> 页

🎨 <b>功能状态</b>
🌊 流式搜索: ${configResult.Config.SiteConfig?.FluidSearch ? '✅ 已启用' : '❌ 已禁用'}
🛡️ 内容过滤: ${configResult.Config.SiteConfig?.DisableYellowFilter ? '❌ 已禁用' : '✅ 已启用'}
🎭 数据代理: ${configResult.Config.SiteConfig?.DoubanProxyType || '默认'}
🖼️ 图片代理: ${configResult.Config.SiteConfig?.DoubanImageProxyType || '默认'}

📈 <b>服务质量</b>
⚡ 状态: <b>${getLatencyStatus(apiResponseTime)}</b> ${apiResponseTime}ms
🌐 访问: <b>${getLatencyStatus(moontvResponseTime)}</b> ${moontvResponseTime !== null ? moontvResponseTime + 'ms' : '未知'}
📱 移动端: <b>兼容</b>

<i>最后更新: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</i>`;

            await sendMessage(bot_token, chatId, stateMessage, moontvUrl, configSiteName);
            return new Response('OK');

        } catch (apiError) {
            console.error('获取站点状态失败:', apiError);
            await sendMessage(bot_token, chatId, `❌ 获取站点状态失败: ${apiError.message}\n\n请稍后再试或联系管理员。`, moontvUrl, siteName);
            return new Response('OK');
        }

    } catch (error) {
        console.error('Error in state command:', error);
        await sendMessage(bot_token, chatId, "❌ 操作失败，请稍后再试。", moontvUrl, siteName);
        return new Response('OK');
    }
}

// 处理 /pwd 命令
async function handlePasswordCommand(bot_token, userId, chatId, chatType, GROUP_ID, newPassword, apiUrl, moontvUrl, username, password, KV, siteName) {
    try {
        // 检查是否在群聊或超级群组中
        if (chatType === 'group' || chatType === 'supergroup') {
            // 在群聊中，只提示用户私聊机器人
            const botInfo = await getBotInfo(bot_token);
            const botUsername = botInfo ? botInfo.username : 'bot';
            
            await sendMessage(bot_token, chatId, `🔐 为了保护您的账户安全，请私聊机器人修改密码\n\n💬 点击 @${botUsername}\n\n⚠️ 在群聊中修改密码会暴露您的新密码`, moontvUrl, siteName);
            return new Response('OK');
        }

        // 以下是原来的私聊处理逻辑
        // 检查用户是否在群组中
        const isInGroup = await checkUserInGroup(bot_token, GROUP_ID, userId);

        if (!isInGroup) {
            const groupName = await getGroupName(bot_token, GROUP_ID);
            await sendMessage(bot_token, chatId, `⚠️ 当前用户无权限，只允许 <b>${groupName}</b> 群组内部人员使用。`, moontvUrl, siteName);
            return new Response('OK');
        }

        if (!newPassword || newPassword.length < 6) {
            await sendMessage(bot_token, chatId, "❌ 密码长度至少6位，请重新输入。\n\n💡 使用方法：<code>/pwd</code> 你的新密码", moontvUrl, siteName);
            return new Response('OK');
        }

        // 检查用户是否已注册（通过API查询）
        const userExists = await checkUserExists(apiUrl, username, password, KV, userId.toString());

        if (!userExists) {
            await sendMessage(bot_token, chatId, "❌ 用户未注册，请先使用 /start 命令注册账户。", moontvUrl, siteName);
            return new Response('OK');
        }

        // 调用API修改密码
        try {
            const cookie = await getCookie(apiUrl, username, password, KV);

            const changePasswordResponse = await fetch(`${apiUrl.replace(/\/$/, '')}/api/admin/user`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Cookie': cookie,
                    'User-Agent': USER_AGENT
                },
                body: JSON.stringify({
                    targetUsername: userId.toString(),
                    targetPassword: newPassword,
                    action: 'changePassword'
                })
            });

            if (!changePasswordResponse.ok) {
                throw new Error(`修改密码API失败: HTTP ${changePasswordResponse.status}`);
            }

            const changeResult = await changePasswordResponse.json();
            if (!changeResult.ok) {
                throw new Error('修改密码失败');
            }

            await sendMessage(bot_token, chatId, `✅ 密码修改成功！\n\n🆔 <b>用户名：</b><code>${userId}</code> (您的TG数字ID)\n🔑 <b>访问密码：</b><code>${newPassword}</code>\n\n💡 新密码已生效，请妥善保存`, moontvUrl);
            return new Response('OK');
        } catch (apiError) {
            console.error('修改密码API失败:', apiError);
            await sendMessage(bot_token, chatId, `❌ 密码修改失败: ${apiError.message}\n\n请稍后再试或联系管理员。`, moontvUrl, siteName);
            return new Response('OK');
        }
    } catch (error) {
        console.error('Error in password command:', error);
        await sendMessage(bot_token, chatId, "❌ 密码修改失败，请稍后再试。", moontvUrl, siteName);
        return new Response('OK');
    }
}

// 获取机器人信息
async function getBotInfo(bot_token) {
    try {
        const response = await fetch(`https://api.telegram.org/bot${bot_token}/getMe`);
        if (!response.ok) {
            return null;
        }
        const result = await response.json();
        return result.ok ? result.result : null;
    } catch (error) {
        console.error('Error getting bot info:', error);
        return null;
    }
}

// 检查用户是否在群组中
async function checkUserInGroup(bot_token, groupId, userId) {
    try {
        const response = await fetch(`https://api.telegram.org/bot${bot_token}/getChatMember`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: groupId,
                user_id: userId
            }),
        });

        const result = await response.json();

        if (result.ok) {
            const member = result.result;
            const status = member.status;
            
            // 原有的有效状态：创建者、管理员、普通成员
            const isStandardMember = ['creator', 'administrator', 'member'].includes(status);
            
            // 新增：受限制但仍是成员的情况
            // 如果状态是restricted但is_member为true，说明用户仍然是群组成员，只是被限制了某些权限
            const isRestrictedMember = status === 'restricted' && member.is_member === true;
            
            // 排除的状态：已离开、被踢出
            const isExcludedStatus = ['left', 'kicked'].includes(status);
            
            // 最终判断：标准成员 或 受限制成员，但不能是已离开/被踢出的
            const isValidMember = (isStandardMember || isRestrictedMember) && !isExcludedStatus;
            
            // 记录详细日志，方便调试
            console.log(`用户 ${userId} 群组状态检查:`, {
                status: status,
                is_member: member.is_member,
                isStandardMember: isStandardMember,
                isRestrictedMember: isRestrictedMember,
                isExcludedStatus: isExcludedStatus,
                finalResult: isValidMember
            });
            
            return isValidMember;
        }

        return false;
    } catch (error) {
        console.error('Error checking group membership:', error);
        return false;
    }
}

// 获取群组名称
async function getGroupName(bot_token, groupId) {
    try {
        const response = await fetch(`https://api.telegram.org/bot${bot_token}/getChat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: groupId
            }),
        });

        const result = await response.json();

        if (result.ok) {
            return result.result.title || '指定群组';
        }

        return '指定群组';
    } catch (error) {
        console.error('Error getting group name:', error);
        return '指定群组';
    }
}

// 发送消息（带有站点链接按钮）
async function sendMessage(bot_token, chatId, text, moontvUrl = null, siteName = null, appInfo = null) {
    try {
        const messageData = {
            chat_id: chatId,
            text: text,
            parse_mode: 'HTML'
        };

        // 构建内联键盘按钮
        const inlineKeyboard = [];

        // 如果提供了 moontvUrl，添加观影站点按钮
        if (moontvUrl && siteName) {
            const buttonText = `🎬 ${siteName}在线观影`;
            inlineKeyboard.push([{
                text: buttonText,
                url: moontvUrl
            }]);
        }

        // 如果提供了 appInfo，添加APP下载按钮
        if (appInfo && appInfo.downloadUrl && appInfo.version) {
            const appButtonText = `📱 APP客户端下载 ${appInfo.version}`;
            inlineKeyboard.push([{
                text: appButtonText,
                url: appInfo.downloadUrl
            }]);
        } else {
            // 添加默认的APP下载按钮
            const defaultAppButtonText = '📱 APP客户端下载';
            inlineKeyboard.push([{
                text: defaultAppButtonText,
                url: 'https://github.com/MoonTechLab/Selene/releases'
            }]);
        }

        // 如果有按钮，添加到消息中
        if (inlineKeyboard.length > 0) {
            messageData.reply_markup = {
                inline_keyboard: inlineKeyboard
            };
        }

        await fetch(`https://api.telegram.org/bot${bot_token}/sendMessage`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': USER_AGENT
            },
            body: JSON.stringify(messageData)
        });
    } catch (error) {
        console.error('Error sending message:', error);
    }
}

// 纯文本快速发送（无按钮）
async function sendSimpleMessage(bot_token, chatId, text) {
    try {
        const resp = await fetch(`https://api.telegram.org/bot${bot_token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'User-Agent': USER_AGENT },
            body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' })
        });
        return await resp.json();
    } catch (e) {
        console.error('Error sending simple message:', e);
        return null;
    }
}

async function editMessage(bot_token, chatId, messageId, text, replyMarkup = null) {
    try {
        const body = { chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML' };
        if (replyMarkup) {
            body.reply_markup = replyMarkup;
        }
        await fetch(`https://api.telegram.org/bot${bot_token}/editMessageText`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'User-Agent': USER_AGENT },
            body: JSON.stringify(body)
        });
    } catch (e) {
        console.error('Error editing message:', e);
    }
}

async function deleteMessage(bot_token, chatId, messageId) {
    try {
        await fetch(`https://api.telegram.org/bot${bot_token}/deleteMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'User-Agent': USER_AGENT },
            body: JSON.stringify({ chat_id: chatId, message_id: messageId })
        });
    } catch (e) {
        console.error('Error deleting message:', e);
    }
}

// 仅更新内联键盘
async function editMessageMarkup(bot_token, chatId, messageId, inlineKeyboard) {
    try {
        await fetch(`https://api.telegram.org/bot${bot_token}/editMessageReplyMarkup`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'User-Agent': USER_AGENT },
            body: JSON.stringify({
                chat_id: chatId,
                message_id: messageId,
                reply_markup: { inline_keyboard: inlineKeyboard }
            })
        });
    } catch (e) {
        console.error('Error editing message markup:', e);
    }
}

async function answerCallback(bot_token, callbackQueryId, text = null, showAlert = false) {
    try {
        const payload = { callback_query_id: callbackQueryId };
        if (text) payload.text = text;
        if (showAlert) payload.show_alert = true;
        await fetch(`https://api.telegram.org/bot${bot_token}/answerCallbackQuery`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'User-Agent': USER_AGENT },
            body: JSON.stringify(payload)
        });
    } catch (e) {
        console.error('Error answering callback:', e);
    }
}

function buildCollapsedConvertKeyboard() {
    return {
        inline_keyboard: [[{ text: '是否转换订阅（例如：Loon|QX|小火箭等） ▶️', callback_data: 'ask_convert' }]]
    };
}

function buildProcessingKeyboard() {
    return {
        inline_keyboard: [[{ text: '⏳ 正在生成，请稍候…', callback_data: 'noop' }]]
    };
}

function buildExpandedConvertKeyboard(substoreBase, substoreName, originalSubUrl, displayName = '订阅') {
    const base = substoreBase.replace(/\/$/, '');
    const urlParam = encodeURIComponent(originalSubUrl);
    const relay = (target) => `${base}/download/${encodeURIComponent(substoreName)}?url=${urlParam}&target=${target}&noCache=true`;
    const enc = encodeURIComponent;
    const b64url = (s) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/,'');

    // 深度链接（尽量直接拉起客户端）
    const links = {
        // iOS: Loon（部分版本支持）
        loon: `loon://import?nodelist=${enc(relay('uri'))}`,
        // iOS: Shadowrocket 使用 base64(url) 的 sub:// 方案
        shadowrocket: `shadowrocket://add/sub://${b64url(relay('uri'))}?remark=${enc(displayName)}`,
        // iOS: Quantumult X
        quanx: `quantumult-x:///update-configuration?remote-resource=${enc(JSON.stringify({ server_remote: [`${relay('uri')}, tag=${displayName}`] }))}`,
        // iOS/macOS: Surge
        surge: `surge:///install-config?url=${enc(relay('surge'))}&name=${enc(displayName)}`,
        'surge-mac': `surge-mac:///install-config?url=${enc(relay('surge-mac'))}&name=${enc(displayName)}`,
        // iOS: Stash（Clash 格式）
        stash: `stash://install-config?url=${enc(relay('stash'))}&name=${enc(displayName)}`,
        // iOS: Egern（Clash 格式）
        egern: `egern:///policy_groups/new?name=${enc(displayName)}&url=${enc(relay('egern'))}`,
        // iOS/Android: sing-box
        singbox: `sing-box://import-remote-profile?url=${enc(relay('singbox'))}#${enc(displayName)}`,
        // Android: V2RayNG（不同版本可能差异，提供常见 scheme）
        v2ray: `v2rayng://import-subscription?url=${enc(relay('v2ray'))}`,
        // Clash（通用客户端）
        clash: `clash://install-config?url=${enc(relay('clash'))}`
    };

    const mk = (label, key) => {
        const href = links[key] || relay(key);
        // Telegram 机器人内联按钮仅可靠支持 http/https 链接
        const safeHref = /^https?:\/\//i.test(href) ? href : relay(key);
        return { text: label, url: safeHref };
    };

    // 排列：每行3个
    const row1 = [
        mk('Loon', 'loon'),
        mk('Shadowrocket', 'shadowrocket'),
        mk('Quantumult X', 'quanx')
    ];
    const row2 = [
        mk('Surge', 'surge'),
        mk('Surge(macOS)', 'surge-mac'),
        mk('Stash', 'stash')
    ];
    const row3 = [
        mk('Egern', 'egern'),
        mk('sing-box', 'singbox'),
        mk('V2Ray', 'v2ray')
    ];
    const row4 = [
        mk('Clash', 'clash')
    ];
    const row5 = [
        { text: '◀️ 收起', callback_data: 'collapse_convert' }
    ];

    return { inline_keyboard: [row1, row2, row3, row4, row5] };
}

function buildDeepLinksSection(substoreBase, substoreName, originalSubUrl, displayName = '订阅') {
    try {
        const base = substoreBase.replace(/\/$/, '');
        const urlParam = encodeURIComponent(originalSubUrl);
        const relay = (target) => `${base}/download/${encodeURIComponent(substoreName)}?url=${urlParam}&target=${target}&noCache=true`;
        const enc = encodeURIComponent;
        const b64url = (s) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

        const links = {
            'Loon': `loon://import?nodelist=${enc(relay('uri'))}`,
            'Shadowrocket': `shadowrocket://add/sub://${b64url(relay('uri'))}?remark=${enc(displayName)}`,
            'Quantumult X': `quantumult-x:///add-resource?remote=${enc(relay('quanx'))}&tag=${enc(displayName)}`,
            'Surge': `surge:///install-config?url=${enc(relay('surge'))}&name=${enc(displayName)}`,
            'Surge(macOS)': `surge-mac:///install-config?url=${enc(relay('surge-mac'))}&name=${enc(displayName)}`,
            'Stash': `stash://install-config?url=${enc(relay('stash'))}&name=${enc(displayName)}`,
            'Egern': `egern://install-config?url=${enc(relay('egern'))}&name=${enc(displayName)}`,
            'sing-box': `sing-box://import-remote-profile?url=${enc(relay('singbox'))}#${enc(displayName)}`,
            'V2Ray': `v2rayng://import-subscription?url=${enc(relay('v2ray'))}`
        };

        const order = ['Loon','Shadowrocket','Quantumult X','Surge','Surge(macOS)','Stash','Egern','sing-box','V2Ray'];
        const lines = order.map(name => {
            const href = links[name];
            // 用超链接包装名称，点击即使用深链/或 http 回落
            return `• <a href="${href}">${name}</a>`;
        });
        return ['\n<b>客户端一键导入</b>：', ...lines].join('\n');
    } catch {
        return '';
    }
}

function buildOpenPageSection(publicBase, substoreBase, substoreName, originalSubUrl, displayName = '订阅') {
    try {
        const base = substoreBase.replace(/\/$/, '');
        const pb = publicBase.replace(/\/$/, '');
        const urlParam = encodeURIComponent(originalSubUrl);
        const relay = (target) => `${base}/download/${encodeURIComponent(substoreName)}?url=${urlParam}&target=${target}&noCache=true`;
        const enc = encodeURIComponent;
        const b64url = (s) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/,'');

        // 目标 app scheme（由中转页触发）
        const schemes = {
            'Loon': `loon://import?nodelist=${enc(relay('uri'))}`,
            'Shadowrocket': `shadowrocket://add/sub://${b64url(relay('uri'))}?remark=${enc(displayName)}`,
            'Quantumult X': `quantumult-x:///update-configuration?remote-resource=${enc(JSON.stringify({ server_remote: [`${relay('uri')}, tag=${displayName}`] }))}`,
            'Surge': `surge:///install-config?url=${enc(relay('surge'))}&name=${enc(displayName)}`,
            'Surge(macOS)': `surge-mac:///install-config?url=${enc(relay('surge-mac'))}&name=${enc(displayName)}`,
            'Stash': `stash://install-config?url=${enc(relay('stash'))}&name=${enc(displayName)}`,
            'Egern': `egern:///policy_groups/new?name=${enc(displayName)}&url=${enc(relay('egern'))}`,
            'sing-box': `sing-box://import-remote-profile?url=${enc(relay('singbox'))}#${enc(displayName)}`,
            'V2Ray': `v2rayng://import-subscription?url=${enc(relay('v2ray'))}`,
            'Clash': `clash://install-config?url=${enc(relay('clash'))}`
        };

        const order = ['Loon','Shadowrocket','Quantumult X','Surge','Surge(macOS)','Stash','Egern','sing-box','V2Ray','Clash'];
        const lines = order.map(name => {
            const scheme = schemes[name];
            const fallback = '';
            const openUrl = `${pb}/open?app=${enc(name)}&scheme=${enc(scheme)}&fallback=${enc(fallback)}`;
            return `• <a href="${openUrl}">${name}</a>`;
        });
        return ['\n<b>客户端一键导入</b>：', ...lines].join('\n');
    } catch {
        return '';
    }
}

// 获取Cookie函数
async function getCookie(apiUrl, username, password, KV) {
    try {
        // 先检查KV中是否存在cookie
        let cookieData = await KV.get('cookie');

        if (cookieData) {
            try {
                // 解析cookie获取timestamp
                const cookieObject = JSON.parse(cookieData);
                const currentTime = Date.now();
                const cookieTime = cookieObject.timestamp;

                // 检查是否超过5天 (5 * 24 * 60 * 60 * 1000 = 432000000毫秒)
                if (currentTime - cookieTime < 432000000) {
                    // Cookie未过期，直接使用存储的原始cookie数据进行编码
                    const encodedCookie = encodeURIComponent(encodeURIComponent(cookieData));
                    console.log('使用缓存的Cookie');
                    console.log('缓存的原始Cookie JSON:', cookieData);
                    console.log('Cookie timestamp:', cookieTime, '当前时间:', currentTime, '差值(小时):', (currentTime - cookieTime) / (1000 * 60 * 60));
                    console.log('最终编码的Cookie:', `auth=${encodedCookie}`);
                    return `auth=${encodedCookie}`;
                }
            } catch (parseError) {
                console.log('Cookie解析失败，将重新获取:', parseError.message);
            }
        }

        // Cookie不存在或已过期，重新获取
        console.log('正在获取新的Cookie...');
        const loginResponse = await fetch(`${apiUrl.replace(/\/$/, '')}/api/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': USER_AGENT
            },
            body: JSON.stringify({
                username: username,
                password: password
            })
        });

        if (!loginResponse.ok) {
            throw new Error(`登录请求失败: ${loginResponse.status}`);
        }

        const loginResult = await loginResponse.json();
        if (!loginResult.ok) {
            throw new Error('登录失败: 用户名或密码错误');
        }

        // 从响应头中获取Set-Cookie
        const setCookieHeader = loginResponse.headers.get('set-cookie');
        if (!setCookieHeader) {
            throw new Error('未收到Cookie响应');
        }

        console.log('服务器返回的Set-Cookie头:', setCookieHeader);

        // 解析auth cookie
        const authCookieMatch = setCookieHeader.match(/auth=([^;]+)/);
        if (!authCookieMatch) {
            throw new Error('未找到auth cookie');
        }

        const encodedCookieValue = authCookieMatch[1];
        console.log('从Set-Cookie中提取的auth值:', encodedCookieValue);

        // 进行两次URL解码获取原始cookie JSON
        const decodedOnce = decodeURIComponent(encodedCookieValue);
        const decodedTwice = decodeURIComponent(decodedOnce);
        console.log('解码后的原始Cookie JSON:', decodedTwice);

        // 验证JSON格式
        const cookieObject = JSON.parse(decodedTwice);
        console.log('解析后的Cookie对象:', JSON.stringify(cookieObject));
        console.log('Cookie中的timestamp:', cookieObject.timestamp);

        // 直接存储原始cookie JSON字符串，不做任何修改
        await KV.put('cookie', decodedTwice);

        // 返回编码后的cookie
        const finalEncodedCookie = encodeURIComponent(encodeURIComponent(decodedTwice));
        console.log('获取并保存了新的Cookie');
        console.log('最终编码的Cookie:', `auth=${finalEncodedCookie}`);
        return `auth=${finalEncodedCookie}`;

    } catch (error) {
        console.error('获取Cookie失败:', error);
        throw error;
    }
}

// 检查用户是否已注册
async function checkUserExists(apiUrl, username, password, KV, targetUsername) {
    try {
        const cookie = await getCookie(apiUrl, username, password, KV);

        const configResponse = await fetch(`${apiUrl.replace(/\/$/, '')}/api/admin/config`, {
            method: 'GET',
            headers: {
                'Cookie': cookie,
                'User-Agent': USER_AGENT
            }
        });

        if (!configResponse.ok) {
            throw new Error(`获取配置API失败: HTTP ${configResponse.status}`);
        }

        const configResult = await configResponse.json();

        if (!configResult.Config || !configResult.Config.UserConfig || !configResult.Config.UserConfig.Users) {
            return false;
        }

        // 检查用户是否存在
        const userExists = configResult.Config.UserConfig.Users.some(user => user.username === targetUsername);
        return userExists;

    } catch (error) {
        console.error('检查用户是否存在失败:', error);
        return false;
    }
}
