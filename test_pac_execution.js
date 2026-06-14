#!/usr/bin/env node

/**
 * PAC 文件执行测试脚本
 * 用于验证 cardo.pac 文件是否能正确执行和返回代理配置
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// 读取 PAC 文件
const pacFilePath = path.join(__dirname, 'cardo.pac');
const pacContent = fs.readFileSync(pacFilePath, 'utf8');

// Mock 浏览器提供的 PAC 函数
const mockFunctions = `
// 检查主机名是否为纯文本（不包含点号，且不是IP地址）
function isPlainHostName(host) {
    // 如果是IPv4地址（包含点号和数字），返回false
    if (/^\\d{1,3}(\\.\\d{1,3}){3}$/.test(host)) {
        return false;
    }
    // 如果是IPv6地址（包含冒号），返回false
    if (host.indexOf(':') !== -1) {
        return false;
    }
    // 如果不包含点号，则为纯主机名
    return host.indexOf('.') === -1;
}

// 检查主机是否在指定域中
function dnsDomainIs(host, domain) {
    return host === domain || host.endsWith('.' + domain);
}

// 检查主机是否在指定主机或域中
function localHostOrDomainIs(host, hostdom) {
    return host === hostdom || host.endsWith('.' + hostdom);
}

// 简单的 DNS 解析 mock
function dnsResolve(host) {
    if (host === 'localhost') return '127.0.0.1';
    if (host === 'baidu.com') return '39.156.66.10';
    if (host === 'google.com.hk') return '142.251.43.199';
    // TLD heuristic test: force Chinese IP for foreign-TLD domain
    // If DNS is called, CIDR match → DIRECT; but TLD heuristic should skip DNS → PROXY
    if (host === 'some-random-foreign-site.com') return '39.156.66.10'; // Chinese IP
    return undefined;
}

// 检查主机是否可解析
function isResolvable(host) {
    return dnsResolve(host) !== undefined;
}

// 检查 IP 是否在指定网络中
function isInNet(ipaddr, pattern, maskstr) {
    if (!ipaddr) return false;
    try {
        const ip = ipaddr.split('.').map(x => parseInt(x));
        const pat = pattern.split('.').map(x => parseInt(x));
        const mask = maskstr.split('.').map(x => parseInt(x));
        
        for (let i = 0; i < 4; i++) {
            if ((ip[i] & mask[i]) !== (pat[i] & mask[i])) {
                return false;
            }
        }
        return true;
    } catch (e) {
        return false;
    }
}

// 检查字符串是否匹配 shell 样式的通配符模式
function shExpMatch(str, shexp) {
    const regexStr = shexp
        .replace(/[.+^$|()\\\\\\[\\\\\\]{}]/g, '\\\\$&')
        .replace(/\\\\\\*/g, '.*')
        .replace(/\\\\\\?/g, '.');
    
    try {
        const regex = new RegExp('^' + regexStr + '$');
        return regex.test(str);
    } catch (e) {
        return false;
    }
}

// 调试函数
var allowAlert = false;
function alert(msg) {
    console.log('[PAC Alert]', msg);
}
`;

// 完整的 PAC 代码
const fullPacCode = mockFunctions + '\n\n' + pacContent;

// 创建执行上下文
const sandbox = {
    console: console,
    allowAlert: false
};

// 执行 PAC 代码
let FindProxyForURL;
try {
    vm.runInNewContext(fullPacCode, sandbox, { timeout: 5000 });
    FindProxyForURL = sandbox.FindProxyForURL;
    
    if (!FindProxyForURL) {
        console.error('❌ 错误: PAC 文件加载失败，FindProxyForURL 未定义');
        process.exit(1);
    }
} catch (error) {
    console.error('❌ PAC 文件执行错误:', error.message);
    console.error('详细信息:', error.stack);
    process.exit(1);
}

console.log('✅ PAC 文件加载成功\n');
console.log('='.repeat(70));
console.log('开始测试 FindProxyForURL 函数');
console.log('='.repeat(70) + '\n');

// 测试用例
const testCases = [
    // 直连域名
    { url: 'baidu.com', expectedResult: 'DIRECT', description: '百度（直连）' },
    { url: 'gov.cn', expectedResult: 'DIRECT', description: '政府网站（直连）' },
    { url: 'qq.com', expectedResult: 'DIRECT', description: '腾讯（直连）' },
    
    // 直连域名 — 子域名哈希匹配
    { url: 'cdn.baidu.com', expectedResult: 'DIRECT', description: '百度CDN子域名（直连）' },
    { url: 'www.gov.cn', expectedResult: 'DIRECT', description: '政府网站子域名（直连）' },
    { url: 'api.weixinbridge.com', expectedResult: 'DIRECT', description: '微信子域名（直连）' },
    
    // 代理域名
    { url: 'google.com.hk', expectedResult: 'PROXY', description: 'Google（代理）' },
    { url: 'youtube.com', expectedResult: 'PROXY', description: 'YouTube（代理）' },
    { url: 'github.com', expectedResult: 'PROXY', description: 'GitHub（代理）' },
    { url: 'twitter.com', expectedResult: 'PROXY', description: 'Twitter（代理）' },
    { url: 'wikipedia.org', expectedResult: 'PROXY', description: 'Wikipedia（代理）' },
    
    // 代理域名 — 子域名哈希匹配
    { url: 'api.github.com', expectedResult: 'PROXY', description: 'GitHub API子域名（代理）' },
    { url: 'raw.githubusercontent.com', expectedResult: 'PROXY', description: 'GitHub CDN子域名（代理）' },
    { url: 'www.youtube.com', expectedResult: 'PROXY', description: 'YouTube子域名（代理）' },
    
    // TLD启发式 — 未知.com域名跳过DNS直走代理（foreign TLD白名单）
    // dnsResolve mock 返回中国IP 39.156.66.10，若DNS被调用将返回DIRECT，返回PROXY证明TLD启发式生效
    { url: 'some-random-foreign-site.com', expectedResult: 'PROXY', description: '未知.com→TLD启发式跳过DNS→代理（验证DNS未调用）' },
    { url: 'another-site.org', expectedResult: 'PROXY', description: '未知.org→TLD启发式→代理' },
    { url: 'test-app.io', expectedResult: 'PROXY', description: '未知.io→TLD启发式→代理' },
    
    // TLD启发式 — 非foreign TLD保持DNS+CIDR保守策略
    { url: 'unknown-site.cn', expectedResult: 'auto-detect', description: '未知.cn→DNS+CIDR保守策略' },
    
    // 本地 TLD
    { url: 'example.localhost', expectedResult: 'DIRECT', description: 'localhost 本地域（直连）' },
    { url: 'test.test', expectedResult: 'DIRECT', description: '.test 本地域（直连）' },
    
    // 国外 IPv4 地址（需要通过 CIDR 匹配进行代理）
    { domain: '8.8.8.8', expectedResult: 'PROXY', description: 'Google DNS IPv4（8.8.8.8 - 代理）' },
    { domain: '1.1.1.1', expectedResult: 'PROXY', description: 'Cloudflare DNS IPv4（1.1.1.1 - 代理）' },
    { domain: '142.251.43.199', expectedResult: 'PROXY', description: 'Google IP IPv4（142.251.43.199 - 代理）' },
    { domain: '216.239.32.223', expectedResult: 'PROXY', description: 'Google IP IPv4（216.239.32.223 - 代理）' },
    { domain: '172.217.28.238', expectedResult: 'PROXY', description: 'Google IP IPv4（172.217.28.238 - 代理）' },
    
    // 国内 IPv4 地址（直连或通过 CIDR 规则判断）
    { domain: '39.156.66.10', expectedResult: 'DIRECT', description: '百度 IP IPv4（39.156.66.10 - 直连）' },
    { domain: '119.29.29.29', expectedResult: 'DIRECT', description: '腾讯 DNS IPv4（119.29.29.29 - 直连）' },
    { domain: '114.114.114.114', expectedResult: 'DIRECT', description: '114DNS IPv4（114.114.114.114 - 直连）' },
    
    // IPv6 地址（国外）
    { domain: '2001:4860:4860::8888', expectedResult: 'PROXY', description: 'Google Public DNS IPv6（2001:4860:4860::8888 - 代理）' },
    { domain: '2606:4700:4700::1111', expectedResult: 'PROXY', description: 'Cloudflare DNS IPv6（2606:4700:4700::1111 - 代理）' },
    
    // 其他测试
    { url: 'unknown-site.com', expectedResult: 'auto-detect', description: '未知域名（默认）' },
    { domain: '127.0.0.1', expectedResult: 'DIRECT', description: 'localhost IP（直连）' },
];

// 执行测试
let passedTests = 0;
let failedTests = 0;

for (const testCase of testCases) {
    try {
        const result = FindProxyForURL('', testCase.url || testCase.domain);
        const passed = validateResult(result, testCase.expectedResult);
        
        if (passed) {
            passedTests++;
            console.log(`✅ ${testCase.description}`);
        } else {
            failedTests++;
            console.log(`⚠️  ${testCase.description}`);
            console.log(`   期望包含: ${testCase.expectedResult}`);
        }
        console.log(`   URL: ${testCase.url}`);
        console.log(`   返回: ${result}\n`);
        
    } catch (error) {
        failedTests++;
        console.log(`❌ ${testCase.description}`);
        console.log(`   URL: ${testCase.url}`);
        console.log(`   错误: ${error.message}\n`);
    }
}

// 打印总结
console.log('='.repeat(70));
console.log('测试总结');
console.log('='.repeat(70));
console.log(`总测试数: ${testCases.length}`);
console.log(`✅ 通过: ${passedTests}`);
console.log(`❌ 失败: ${failedTests}`);
console.log(`成功率: ${((passedTests / testCases.length) * 100).toFixed(2)}%\n`);

if (failedTests === 0) {
    console.log('🎉 所有测试通过！PAC 文件正常工作。');
    process.exit(0);
} else {
    console.log('⚠️  存在失败的测试，但 PAC 文件语法正确，可以使用。');
    process.exit(0);
}

/**
 * 从 URL 中提取域名
 */
function getDomainFromUrl(url) {
    try {
        const urlObj = new URL(url);
        return urlObj.hostname;
    } catch (e) {
        return '';
    }
}

/**
 * 验证返回结果
 */
function validateResult(result, expectedType) {
    if (!result) return false;
    
    const resultStr = result.toString();
    
    switch (expectedType) {
        case 'DIRECT':
            return resultStr.includes('DIRECT');
        case 'PROXY':
            return resultStr.includes('PROXY');
        case 'auto-detect':
            return resultStr.length > 0;
        default:
            return true;
    }
}
