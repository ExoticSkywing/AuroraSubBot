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
    const tokens = [
        ['中国','中国'],['香港','香港'],['台湾','台湾'],['美国','美国'],['日本','日本'],['新加坡','新加坡'],
        ['韩国','韩国'],['德国','德国'],['英国','英国'],['法国','法国'],['加拿大','加拿大'],['澳大利亚','澳大利亚'],
        ['俄罗斯','俄罗斯'],['印度','印度'],['荷兰','荷兰'],['瑞士','瑞士'],['瑞典','瑞典'],['挪威','挪威'],
        ['丹麦','丹麦'],['芬兰','芬兰'],['土耳其','土耳其'],['越南','越南'],['泰国','泰国'],['马来西亚','马来西亚'],
        ['菲律宾','菲律宾'],['印度尼西亚','印尼'],['阿联酋','阿联酋'],['墨西哥','墨西哥'],['巴西','巴西'],['阿根廷','阿根廷']
    ];
    const found = new Set();
    for (const name of names) {
        for (const [kw, label] of tokens) {
            if (name && name.includes(kw)) found.add(label);
        }
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

async function handleSubscriptionInfoCommand(bot_token, chatId, subUrl, moontvUrl, siteName, misubBase, misubAdminPassword, substoreBase, substoreName) {
    try {
        // 先回执
        await sendSimpleMessage(bot_token, chatId, '🔎 正在查询订阅信息，请稍候...');

        let count = null;
        let userInfo = null;
        let debug = null;

        if (misubBase) {
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

        // 若 MiSub 不可用或需要鉴权，走直连兜底解析
        // 从 Sub-Store 拉节点（强制 target=base64，UA v2rayN），并统计节点信息（优先以 Sub-Store 为准）
        let nodeSampleNames = [];
        let protocols = [];
        let sampledCountries = [];
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
                            if (jsonTypes.length) {
                                protocols = Array.from(new Set(jsonTypes.map(t => String(t).toUpperCase())));
                            }
                            if (jsonNames.length) {
                                nodeSampleNames = sampleArray(jsonNames, 3);
                                const countryNames = sampleArray(jsonNames, 5);
                                sampledCountries = Array.from(new Set(detectCountries(countryNames)));
                            }
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
                        const protoSet = new Set();
                        nodeLines.forEach(l => { const m = l.match(/^(\w+):\/\//); if (m) protoSet.add(m[1].toLowerCase()); });
                        protocols = Array.from(protoSet).map(p => p.toUpperCase());
                        count = nodeLines.length;
                        const namesAll = nodeLines.map(decodeNodeName).map(n => n && n.trim()).filter(Boolean);
                        if (namesAll.length === 0) {
                            const reName = /#([^#\n\r]*)$/;
                            const fallback = nodeLines.map(l => {
                                const m = l.match(reName); return m ? decodeURIComponent(m[1]) : null;
                            }).filter(Boolean);
                            namesAll.push(...fallback);
                        }
                        nodeSampleNames = sampleArray(namesAll, 3);
                        const countryNames = sampleArray(namesAll, 5);
                        sampledCountries = Array.from(new Set(detectCountries(countryNames)));
                    }
                }
            } catch (e) {
                // 忽略 Sub-Store 错误，继续输出已获取的信息
            }
        }
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
        const protocolTop = buildTopN(mergedProtocols.map(normalizeProtocolName), 5);
        const countryTop = buildTopN(sampledCountries.length ? sampledCountries : detectCountries((debug?.validNodes || []).map(decodeNodeName)), 5);

        const lines = [];
        lines.push(`订阅链接: <code>${subUrl}</code>`);
        if (used !== null && total !== null) {
            lines.push(`流量详情: ${formatBytes(used)} / ${formatBytes(total)}`);
            if (percent !== null) lines.push(`使用进度: ${bar} ${percent.toFixed(1)}%`);
            if (remain !== null) lines.push(`剩余可用: ${formatBytes(remain)}`);
        }
        if (expire) {
            const cn = expire.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
            const daysLeft = Math.ceil((expire.getTime() - Date.now()) / (24 * 3600 * 1000));
            lines.push(`到期时间: ${cn}（剩余 ${daysLeft} 天）`);
        } else if (userInfo && userInfo.expire === 0) {
            lines.push('到期时间: 长期有效');
        }
        if (typeof count === 'number') lines.push(`节点总数: ${count}`);
        if (mergedProtocols.length) lines.push(`协议类型: ${Array.from(new Set(mergedProtocols.map(normalizeProtocolName))).join(', ')}`);
        if (countries.length) lines.push(`覆盖范围: ${countries.join('、')}`);
        if (protocolTop.length) {
            lines.push('协议占比:');
            renderBarChart(protocolTop, mergedProtocols.length).forEach(l => lines.push(l));
        }
        if (countryTop.length) {
            lines.push('地区占比:');
            renderBarChart(countryTop, (sampledCountries.length ? sampledCountries : countries).length).forEach(l => lines.push(l));
        }
        if (sampleNames.length) {
            lines.push('示例节点:');
            sampleNames.forEach(n => lines.push(n));
        } else {
            lines.push('示例节点: 暂无可用名称');
        }

        await sendSimpleMessage(bot_token, chatId, lines.join('\n'));
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
        const url = new URL(request.url);
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

        // 处理 Telegram Webhook
        if (request.method === 'POST') {
            return await handleTelegramWebhook(request, bot_token, GROUP_ID, apiUrl, moontvUrl, username, password, env.KV, siteName, misubBase, misubAdminPassword, substoreBase, substoreName);
        }

        // 默认返回404错误页面（伪装）
        return new Response("Not Found", { status: 404 });
    },
};

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
async function handleTelegramWebhook(request, bot_token, GROUP_ID, apiUrl, moontvUrl, username, password, KV, siteName, misubBase, misubAdminPassword, substoreBase, substoreName) {
    try {
        const update = await request.json();

        if (update.message && update.message.text) {
            const message = update.message;
            const userId = message.from.id;
            const chatId = message.chat.id;
            const text = message.text;

            // 检查命令是否是发给当前机器人的
            const { isForThisBot, normalizedText } = await isCommandForThisBot(text, bot_token);

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
                return await handleSubscriptionInfoCommand(bot_token, chatId, subUrl, moontvUrl, siteName, misubBase, misubAdminPassword, substoreBase, substoreName);
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
        await fetch(`https://api.telegram.org/bot${bot_token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'User-Agent': USER_AGENT },
            body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' })
        });
    } catch (e) {
        console.error('Error sending simple message:', e);
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
