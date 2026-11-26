/**
 * Cart Store - Đồng bộ giỏ hàng trực tiếp với Spring Boot
 */
import { createStore } from '../core/store.js';
import { apiClient, tokenManager } from '../services/apiClient.js';

const store = createStore('phh_cart_store', { items: [] });

let isLoaded = false;
let loadPromise = null;

// Chuẩn hóa dữ liệu CartItemResponseDTO từ Backend
function mapCartItem(dto) {
  return {
    id: dto.cartItemId ?? dto.id,
    cartItemId: dto.cartItemId ?? dto.id,

    variantId: dto.variantId,
    productId: dto.productId,
    productName: dto.productName || 'Sản phẩm',

    thumbnail: dto.thumbnail || dto.image || '',

    image: dto.image || dto.thumbnail || '',

    variantSpec: dto.variantSpec || dto.spec || '',
    variantColor: dto.variantColor || dto.color || '',

    price: Number(dto.price ?? dto.listPrice ?? 0),
    listPrice: Number(dto.listPrice ?? dto.price ?? 0),

    quantity: Number(dto.quantity || 1),
    stockQty: Number(dto.stockQty || 0),

    subtotal: Number(dto.subtotal || 0)
  };
}

export const cartStore = {
  get() {
    return store.get();
  },

  getItems() {
    return store.get().items || [];
  },

  // Lấy giỏ hàng từ Backend
  async ensureLoaded(force = false) {
    if (isLoaded && !force) {
      return this.getItems();
    }

    if (loadPromise && !force) {
      return loadPromise;
    }

    // Khách chưa đăng nhập: không gọi API giỏ hàng
    if (!tokenManager.get('client')) {
      store.set({ items: [] });
      isLoaded = false;
      return [];
    }

    loadPromise = (async () => {
      try {
        const response = await apiClient.getCart();

        const items = Array.isArray(response?.items)
          ? response.items.map(mapCartItem)
          : [];

        store.set({ items });
        isLoaded = true;

        return items;
      } catch (error) {
        isLoaded = false;
        throw error;
      } finally {
        loadPromise = null;
      }
    })();

    return loadPromise;
  },

  count() {
    return this.getItems().reduce(
      (sum, item) => sum + Number(item.quantity || 0),
      0
    );
  },

  totalAmount() {
    return this.getItems().reduce(
      (sum, item) =>
        sum + Number(item.price || 0) * Number(item.quantity || 0),
      0
    );
  },

  // Thêm sản phẩm
  async addItem(variantId, quantity = 1) {
    if (!tokenManager.get('client')) {
      throw new Error('Vui lòng đăng nhập để sử dụng giỏ hàng.');
    }

    await apiClient.addToCart(variantId, quantity);

    return await this.ensureLoaded(true);
  },

  // Cập nhật số lượng
  async updateQuantity(variantId, quantity) {
    const item = this.getItems().find(
      x => Number(x.variantId) === Number(variantId)
    );

    if (!item) {
      throw new Error('Không tìm thấy sản phẩm trong giỏ hàng.');
    }

    await apiClient.updateCartItem(item.cartItemId, quantity);

    return await this.ensureLoaded(true);
  },

  // Xóa một sản phẩm
  async removeItem(variantId) {
    const item = this.getItems().find(
      x => Number(x.variantId) === Number(variantId)
    );

    if (!item) {
      throw new Error('Không tìm thấy sản phẩm trong giỏ hàng.');
    }

    await apiClient.removeCartItem(item.cartItemId);

    return await this.ensureLoaded(true);
  },

  // Xóa toàn bộ giỏ hàng
  async clear() {
    if (!tokenManager.get('client')) {
      store.set({ items: [] });
      return [];
    }

    await apiClient.clearCart();

    store.set({ items: [] });
    isLoaded = true;

    return [];
  },

  // Làm mới khi đăng xuất
  reset() {
    isLoaded = false;
    loadPromise = null;
    store.set({ items: [] });
  },

  subscribe(fn) {
    return store.subscribe(fn);
  }
};