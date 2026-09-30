export const getAccessToken = () => {
  if (typeof window === "undefined") return null;

  return localStorage.getItem("accessToken");
};

export const getRefreshToken = () => {
  if (typeof window === "undefined") return null;

  return localStorage.getItem("refreshToken");
};

export const isAuthenticated = () => {
  return Boolean(getAccessToken());
};

export const setAuthTokens = (
  accessToken: string,
  refreshToken?: string
) => {
  if (typeof window === "undefined") return;

  localStorage.setItem("accessToken", accessToken);

  if (refreshToken) {
    localStorage.setItem("refreshToken", refreshToken);
  }

  window.dispatchEvent(new Event("auth-change"));
};

export const clearAuth = () => {
  if (typeof window === "undefined") return;

  localStorage.removeItem("accessToken");
  localStorage.removeItem("refreshToken");

  window.dispatchEvent(new Event("auth-change"));
};