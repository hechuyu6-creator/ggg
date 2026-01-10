
import { AppData } from "../types";

const GIST_FILENAME = "wechat_ai_data_backup.json";
const GIST_DESCRIPTION = "WeChat AI Cloud Backup (Auto-generated)";

export interface GithubSyncResult {
    success: boolean;
    message: string;
    data?: AppData;
    gistId?: string;
}

// Check result type
interface TokenCheckResult {
    valid: boolean;
    errorMsg?: string;
}

export const validateToken = async (token: string): Promise<TokenCheckResult> => {
    try {
        const cleanToken = token.trim();
        if (!cleanToken) return { valid: false, errorMsg: "Token 不能为空" };

        const headers = {
            Authorization: `Bearer ${cleanToken}`,
            Accept: "application/vnd.github.v3+json",
        };

        // Directly check /gists. This verifies both Authentication AND Scope (gist permission).
        // Using per_page=1 to minimize data transfer.
        const res = await fetch("https://api.github.com/gists?per_page=1", { 
            headers,
            cache: 'no-store',
            mode: 'cors'
        });
        
        if (res.status === 200) {
            return { valid: true };
        }
        
        if (res.status === 401) {
            return { valid: false, errorMsg: "Token 无效 (401): 请检查 Token 是否正确" };
        }

        if (res.status === 403) {
            return { valid: false, errorMsg: "权限不足 (403): Token 可能缺少 'gist' 权限" };
        }

        if (res.status === 404) {
            // Should not happen for /gists unless endpoint changes
            return { valid: false, errorMsg: "无法访问 API (404)" };
        }

        return { valid: false, errorMsg: `验证失败 (${res.status}): 请检查网络` };

    } catch (e: any) {
        console.error("GitHub Connection Error:", e);
        // Distinguish between network error and others if possible
        const msg = e.message || "未知错误";
        if (msg.includes("Failed to fetch") || msg.includes("NetworkError")) {
            return { valid: false, errorMsg: "网络请求失败: 请检查 VPN 是否开启" };
        }
        return { valid: false, errorMsg: `连接错误: ${msg}` };
    }
};

// Kept for compatibility, but internally uses the new logic logic could be refactored, 
// but App.tsx calls validateToken now.
export const checkToken = async (token: string): Promise<boolean> => {
    const result = await validateToken(token);
    return result.valid;
};

export const findBackupGist = async (token: string): Promise<string | null> => {
    try {
        const cleanToken = token.trim();
        // Fetch list of gists to find our file
        const res = await fetch("https://api.github.com/gists", {
            headers: {
                Authorization: `Bearer ${cleanToken}`,
                Accept: "application/vnd.github.v3+json",
            },
            cache: 'no-store'
        });
        if (!res.ok) return null;
        
        const gists = await res.json();
        // Look for file
        const target = gists.find((g: any) => g.files && g.files[GIST_FILENAME]);
        return target ? target.id : null;
    } catch (e) {
        console.error("Find Gist Error", e);
        return null;
    }
};

export const createBackupGist = async (token: string, data: AppData): Promise<string | null> => {
    try {
        const cleanToken = token.trim();
        const payload = {
            description: GIST_DESCRIPTION,
            public: false,
            files: {
                [GIST_FILENAME]: {
                    content: JSON.stringify(data, null, 2)
                }
            }
        };

        const res = await fetch("https://api.github.com/gists", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${cleanToken}`,
                Accept: "application/vnd.github.v3+json",
                "Content-Type": "application/json"
            },
            body: JSON.stringify(payload)
        });

        if (!res.ok) {
            const errorText = await res.text();
            throw new Error(`Status ${res.status}: ${errorText}`);
        }
        const json = await res.json();
        return json.id;
    } catch (e) {
        console.error("Create Gist Error", e);
        throw e; // Propagate error to let UI know why it failed
    }
};

export const updateBackupGist = async (token: string, gistId: string, data: AppData): Promise<boolean> => {
    try {
        const cleanToken = token.trim();
        const payload = {
            files: {
                [GIST_FILENAME]: {
                    content: JSON.stringify(data, null, 2)
                }
            }
        };

        const res = await fetch(`https://api.github.com/gists/${gistId}`, {
            method: "PATCH",
            headers: {
                Authorization: `Bearer ${cleanToken}`,
                Accept: "application/vnd.github.v3+json",
                "Content-Type": "application/json"
            },
            body: JSON.stringify(payload)
        });

        if (!res.ok) {
            const errorText = await res.text();
            throw new Error(`Status ${res.status}: ${errorText}`);
        }

        return true;
    } catch (e) {
        console.error("Update Gist Error", e);
        throw e; // Propagate error to let UI know why it failed (e.g. size limit)
    }
};

export const getGistContent = async (token: string, gistId: string): Promise<AppData | null> => {
    try {
        const cleanToken = token.trim();
        const res = await fetch(`https://api.github.com/gists/${gistId}`, {
            headers: {
                Authorization: `Bearer ${cleanToken}`,
                Accept: "application/vnd.github.v3+json",
            },
            cache: 'no-store'
        });
        
        if (!res.ok) return null;
        
        const json = await res.json();
        const file = json.files[GIST_FILENAME];
        
        if (file && file.truncated) {
            // If truncated, fetch the raw url
            const rawRes = await fetch(file.raw_url);
            return await rawRes.json();
        } else if (file) {
            return JSON.parse(file.content);
        }
        
        return null;
    } catch (e) {
        console.error("Get Gist Content Error", e);
        return null;
    }
};
