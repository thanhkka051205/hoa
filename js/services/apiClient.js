/**
 * API Client kết nối Backend Spring Boot PhaHang
 * Repo tham chiếu: https://github.com/thanhkka051205/PhaHang
 */
import { API_CONFIG } from "../config/apiConfig.js";
import { toUser, unwrapRestResponse } from "./adapters.js";

const TOKEN_KEYS = {
  client: "phahang_jwt_token",
  admin: "phahang_jwt_token_admin",
};

function getTokenKey(scope = "client") {
  return TOKEN_KEYS[scope] || TOKEN_KEYS.client;
}

export const tokenManager = {
  get: (scope = "client") => {
    try {
      return localStorage.getItem(getTokenKey(scope));
    } catch {
      return null;
    }
  },
  set: (token, scope = "client") => {
    try {
      localStorage.setItem(getTokenKey(scope), token);
    } catch {}
  },
  clear: (scope = "client") => {
    try {
      localStorage.removeItem(getTokenKey(scope));
    } catch {}
  },
};

async function request(
  endpoint,
  { method = "GET", body = null, requireAuth = true, scope = "client" } = {},
) {
  const headers = {
    "Content-Type": "application/json",
    "ngrok-skip-browser-warning": "true",
  };

  const token = tokenManager.get(scope);
  if (requireAuth && token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  let url = `${API_CONFIG.BASE_URL}${endpoint}`;
  if (endpoint.startsWith("/order/payments")) {
    const rootBase = (API_CONFIG.BASE_URL || "").replace(/\/api\/?$/, "");
    url = `${rootBase}${endpoint}`;
  }
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_CONFIG.TIMEOUT_MS);

  const options = {
    method,
    headers,
    signal: controller.signal,
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(url, options);
  } catch (error) {
    error.isNetworkError = true;
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }

  if (response.status === 401) {
    tokenManager.clear(scope);
    const err = new Error(
      "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.",
    );
    err.status = 401;
    throw err;
  }

  if (response.status === 403) {
    const err = new Error("Bạn không có quyền thực hiện thao tác này.");
    err.status = 403;
    throw err;
  }

  if (response.status === 204) {
    return null;
  }

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    let errMessage = errText;
    if (errText) {
      try {
        const parsed = JSON.parse(errText);
        errMessage = parsed.message || parsed.error || errText;
      } catch {}
    }
    const err = new Error(
      errMessage ||
        `Yêu cầu máy chủ thất bại với mã trạng thái ${response.status}`,
    );
    err.status = response.status;
    throw err;
  }

  const text = await response.text();
  if (!text) return null;
  const json = JSON.parse(text);
  return unwrapRestResponse(json);
}

export const apiClient = {
  // AuthController (/api/auth)
  async login(username, password, scope = "client") {
    const res = await request("/auth/login", {
      method: "POST",
      body: { username, password },
      requireAuth: false,
      scope,
    });

    // Hỗ trợ cả hai tên trường Token từ Backend
    const accessToken = res?.accessToken || res?.token;

    if (accessToken) {
      tokenManager.set(accessToken, scope);
    }

    return {
      accessToken,
      user: toUser(res?.user),
    };
  },

  async register({ fullName, email, password }) {
    const res = await request("/auth/register", {
      method: "POST",
      body: { fullName, email, password },
      requireAuth: false,
    });
    return toUser(res);
  },

  logout(scope = "client") {
    tokenManager.clear(scope);
  },

  // CategoryController (/api/categories)
  async getCategories() {
    return await request("/categories", { requireAuth: false });
  },

  async getCategoryById(id) {
    return await request(`/categories/${id}`, { requireAuth: false });
  },

  async getCategoryProducts(id) {
    return await request(`/categories/${id}/products`, { requireAuth: false });
  },

  async createCategory(categoryData) {
    return await request("/categories", {
      method: "POST",
      body: categoryData,
    });
  },

  async updateCategory(id, categoryData) {
    return await request(`/categories/${id}`, {
      method: "PUT",
      body: categoryData,
    });
  },

  async deleteCategory(id) {
    return await request(`/categories/${id}`, {
      method: "DELETE",
    });
  },

  // ProductController (/api/products)
  async getProducts({ current = 1, pageSize = 12 } = {}) {
    return await request(`/products?current=${current}&pageSize=${pageSize}`, {
      requireAuth: false,
    });
  },

  async getProductById(id) {
    return await request(`/products/${id}`, { requireAuth: false });
  },

  async searchProducts(keyword) {
    return await request(
      `/products/search?keyword=${encodeURIComponent(keyword)}`,
      { requireAuth: false },
    );
  },

  async filterProducts({ brand, categoryId, minPrice, maxPrice } = {}) {
    const params = new URLSearchParams();
    if (brand) params.set("brand", brand);
    if (categoryId) params.set("categoryId", categoryId);
    if (minPrice !== undefined && minPrice !== null)
      params.set("minPrice", minPrice);
    if (maxPrice !== undefined && maxPrice !== null)
      params.set("maxPrice", maxPrice);
    return await request(`/products/filter?${params.toString()}`, {
      requireAuth: false,
    });
  },

  async createProduct(productData) {
    return await request("/products", {
      method: "POST",
      body: productData,
    });
  },

  async updateProduct(id, productData) {
    return await request(`/products/${id}`, {
      method: "PUT",
      body: productData,
    });
  },

  async deleteProduct(id) {
    return await request(`/products/${id}`, {
      method: "DELETE",
    });
  },

  // UserController (/api/users)
  async getUsers({ current = 1, pageSize = 10 } = {}) {
    return await request(`/users?current=${current}&pageSize=${pageSize}`, {
      scope: "admin",
    });
  },

  async getUserById(userId) {
    return await request(`/users/${userId}`, { scope: "admin" });
  },

  async createUser(userData) {
    return await request("/users", {
      method: "POST",
      body: userData,
      requireAuth: true,
      scope: "admin",
    });
  },

  async updateUser(userId, userData) {
    return await request(`/users/${userId}`, {
      method: "PUT",
      body: userData,
      scope: "admin",
    });
  },

  async updateUserRole(userId, role) {
    const res = await request(`/users/${userId}/role`, {
      method: "PATCH",
      body: {
        role: String(role || "")
          .trim()
          .toUpperCase(),
      },
      scope: "admin",
    });
    return toUser(res);
  },

  async deleteUser(userId) {
    return await request(`/users/${userId}`, {
      method: "DELETE",
      scope: "admin",
    });
  },

  // AddressController (/api/addresses)
  async getAddresses() {
    return await request("/addresses", { scope: "client" });
  },

  async getAddressById(id) {
    return await request(`/addresses/${id}`);
  },

  async getAddressesByUserId(userId) {
    return await request(`/addresses/user/${userId}`);
  },

  async createAddress(addressData) {
    return await request("/addresses", {
      method: "POST",
      body: addressData,
    });
  },

  async updateAddress(id, addressData) {
    return await request(`/addresses/${id}`, {
      method: "PUT",
      body: addressData,
    });
  },

  async deleteAddress(id) {
    return await request(`/addresses/${id}`, {
      method: "DELETE",
    });
  },

  // CartItemController (/api/cart)

  // Giỏ hàng
  async getCart() {
    return await request("/cart", { scope: "client" });
  },

  async addToCart(variantId, quantity = 1) {
    return await request("/cart", {
      method: "POST",
      body: {
        variantId: Number(variantId),
        quantity: Number(quantity),
      },
    });
  },

  async updateCartItem(cartItemId, quantity) {
    return await request(`/cart/${cartItemId}`, {
      method: "PUT",
      body: {
        quantity: Number(quantity),
      },
    });
  },

  async removeCartItem(cartItemId) {
    return await request(`/cart/${cartItemId}`, {
      method: "DELETE",
    });
  },

  async clearCart() {
    return await request("/cart", {
      method: "DELETE",
    });
  },

  // OrderController (/api/orders)
  async createOrder(orderData) {
    return await request("/orders", {
      method: "POST",
      body: {
        receiverName: orderData.receiverName,
        receiverPhone: orderData.receiverPhone,
        shipAddress: orderData.shipAddress,
      },
    });
  },

  // Lấy chi tiết đơn hàng của khách hàng
  async getOrderById(orderId) {
    if (!orderId) {
      throw new Error("Thiếu mã đơn hàng.");
    }

    return await request(`/orders/${Number(orderId)}`, {
      method: "GET",
      requireAuth: true,
      scope: "client",
    });
  },

  // WarrantyController (/api/warranties)
  async getWarranties({ current = 1, pageSize = 50, keyword = "" } = {}) {
    const params = new URLSearchParams({
      current: String(current),
      pageSize: String(pageSize),
    });
    if (keyword) params.set("keyword", keyword.trim());
    return await request(`/warranties?${params.toString()}`, {
      scope: "admin",
    });
  },

  async lookupWarranty({ serialNumber = "", phone = "" } = {}) {
    const params = new URLSearchParams();
    if (serialNumber) params.set("serialNumber", serialNumber.trim());
    if (phone) params.set("phone", phone.trim());
    return await request(`/warranties/lookup?${params.toString()}`, {
      requireAuth: false,
    });
  },

  // CouponController (/api/coupons)
  async getCoupons({ current = 1, pageSize = 50 } = {}) {
    return await request(`/coupons?current=${current}&pageSize=${pageSize}`, {
      scope: "admin",
    });
  },

  async createCoupon(couponData) {
    return await request("/coupons", {
      method: "POST",
      body: couponData,
      requireAuth: true,
      scope: "admin",
    });
  },

  // Áp dụng mã giảm giá (nếu BE có endpoint kiểm tra/tính giảm giá)
  async applyCoupon(code, sumAmount) {
    const normalizedCode = String(code || "")
      .trim()
      .toUpperCase();
    const numericAmount = Number(sumAmount ?? 0);
    const safeAmount = Number.isFinite(numericAmount)
      ? Math.max(0, numericAmount)
      : 0;

    const params = new URLSearchParams({
      code: normalizedCode,
      sumAmount: String(safeAmount),
    });

    return await request(`/coupons/apply?${params.toString()}`, {
      method: "POST",
      scope: "client",
    });
  },

  // OrderController / AdminOrderController
  async getOrders({ current = 1, pageSize = 100 } = {}) {
    return await request(
      `/admin/orders?current=${current}&pageSize=${pageSize}`,
      {
        scope: "admin",
      },
    );
  },

  // Dashboard / Thống kê (điều chỉnh endpoint nếu BE đặt tên khác)
  async getDashboardStats() {
    return await request("/dashboard/stats", {
      scope: "admin",
    });
  },

  // PaymentController (/order/payments) - Backend PhaHang commit afa9fde
  async createPayment({
    orderId = 1,
    method = "COD",
    amount = 0,
    status = "unpaid",
  } = {}) {
    const payload = {
      orderId: Number(orderId) || 1,
      method: String(method || "COD"),
      amount: Number(amount) || 0,
      status: status,
    };
    try {
      const res = await request("/order/payments", {
        method: "POST",
        body: payload,
        requireAuth: false,
      });
      return { success: true, synced: true, data: res };
    } catch (err) {
      // Graceful fallback nếu Backend báo lỗi Foreign Key (chưa có OrderController) hoặc mạng
      return {
        success: true,
        synced: false,
        localOnly: true,
        data: {
          paymentId: Date.now(),
          orderId: payload.orderId,
          method: payload.method,
          amount: payload.amount,
          status: "unpaid",
        },
      };
    }
  },
};
