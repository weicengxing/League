/**
 * 全局认证检查脚本
 * 在所有页面加载前检查登录状态
 */

const AUTH_CONFIG = {
    STORAGE_KEY: 'alliance_user',
    LOGIN_PAGE: 'login.html',
    API_CHECK: '/api/auth/check',
    // index.html 不需要强制登录检查
    EXCLUDED_PAGES: ['login.html', 'register.html', 'forgot.html']
};

// 检查当前页面是否需要认证
function isExcludedPage() {
    const currentPage = window.location.pathname.split('/').pop();
    return AUTH_CONFIG.EXCLUDED_PAGES.includes(currentPage);
}

// 获取存储的用户信息
function getStoredUser() {
    const stored = localStorage.getItem(AUTH_CONFIG.STORAGE_KEY);
    if (!stored) return null;
    
    try {
        const user = JSON.parse(stored);
        // 检查是否过期（7天）
        const sevenDays = 7 * 24 * 60 * 60 * 1000;
        if (user.loginTime && (Date.now() - user.loginTime > sevenDays)) {
            localStorage.removeItem(AUTH_CONFIG.STORAGE_KEY);
            return null;
        }
        return user;
    } catch (e) {
        localStorage.removeItem(AUTH_CONFIG.STORAGE_KEY);
        return null;
    }
}

// 验证服务端 session
async function verifyServerSession() {
    try {
        const response = await fetch(AUTH_CONFIG.API_CHECK, {
            method: 'POST',
            credentials: 'include'
        });
        const data = await response.json();
        return data.valid === true;
    } catch (e) {
        return false;
    }
}

// 跳转到登录页面
function redirectToLogin() {
    const currentPage = window.location.pathname.split('/').pop();
    const returnUrl = encodeURIComponent(window.location.href);
    window.location.href = `${AUTH_CONFIG.LOGIN_PAGE}?return=${returnUrl}`;
}

// 执行认证检查
async function checkAuth() {
    // 如果是登录/注册页面，跳过检查
    if (isExcludedPage()) {
        return true;
    }

    // 检查本地存储
    const storedUser = getStoredUser();
    
    if (!storedUser) {
        redirectToLogin();
        return false;
    }

    // 验证服务端 session
    const isValid = await verifyServerSession();
    
    if (!isValid) {
        // 服务器 session 失效，清除本地存储并跳转
        localStorage.removeItem(AUTH_CONFIG.STORAGE_KEY);
        redirectToLogin();
        return false;
    }

    return true;
}

// 显示用户信息（如果有）
function displayUserInfo() {
    const storedUser = getStoredUser();
    if (storedUser && storedUser.username) {
        const userElements = document.querySelectorAll('.user-username');
        userElements.forEach(el => {
            el.textContent = storedUser.username;
        });
    }
}

// 退出登录
async function logout() {
    try {
        await fetch('/api/auth/logout', {
            method: 'POST',
            credentials: 'include'
        });
    } catch (e) {
        console.error('登出请求失败', e);
    }
    localStorage.removeItem(AUTH_CONFIG.STORAGE_KEY);
    window.location.href = AUTH_CONFIG.LOGIN_PAGE;
}

// 页面加载时执行检查
document.addEventListener('DOMContentLoaded', async function() {
    const authPassed = await checkAuth();
    if (authPassed) {
        displayUserInfo();
    }
});

// 导出全局函数
window.AUTH = {
    checkAuth,
    logout,
    getStoredUser,
    isExcludedPage
};
