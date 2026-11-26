import { mountAdminLayout } from '../components/adminLayout.js';
import { apiClient } from '../services/apiClient.js';
import { unwrapRestResponse } from '../services/adapters.js';
import { formatVND } from '../core/format.js';
import { esc } from '../core/dom.js';

function extractList(res) {
  if (!res) return [];
  if (Array.isArray(res)) return res;
  if (Array.isArray(res.result)) return res.result;
  if (Array.isArray(res.content)) return res.content;
  if (Array.isArray(res.items)) return res.items;
  return [];
}

function buildStatsFromOrdersAndProducts(orders = [], products = []) {
  const validOrders = orders.filter(o => String(o?.status || '').toLowerCase() !== 'cancelled');
  const totalOrders = orders.length;

  const revenueMonth = validOrders.reduce((sum, o) => {
    const amount = Number(o?.totalAmount ?? o?.total_amount ?? 0);
    return sum + (Number.isFinite(amount) ? amount : 0);
  }, 0);

  const avgOrderValue = validOrders.length > 0
    ? Math.round(revenueMonth / validOrders.length)
    : 0;

  // Tổng tồn kho thật từ variants hoặc stockQty của sản phẩm
  const totalStock = products.reduce((sum, p) => {
    if (Array.isArray(p?.variants) && p.variants.length > 0) {
      const vSum = p.variants.reduce((vs, v) => vs + Number(v?.stockQty ?? v?.stock_qty ?? 0), 0);
      return sum + vSum;
    }
    return sum + Number(p?.stockQty ?? p?.stock_qty ?? p?.quantity ?? 0);
  }, 0);

  // Gom doanh thu & số lượng bán theo ngành hàng từ order items
  const categoryMap = new Map();
  const productMap = new Map();

  for (const order of validOrders) {
    const items = Array.isArray(order?.items) ? order.items : [];
    for (const item of items) {
      const qty = Number(item?.quantity ?? 0) || 0;
      const unitPrice = Number(item?.unitPrice ?? item?.unit_price ?? item?.price ?? 0) || 0;
      const lineTotal = Number(item?.subtotal ?? unitPrice * qty) || 0;

      const catName = item?.categoryName ?? item?.category?.name ?? 'Khác';
      const curCat = categoryMap.get(catName) || { name: catName, sold: 0, revenue: 0 };
      curCat.sold += qty;
      curCat.revenue += lineTotal;
      categoryMap.set(catName, curCat);

      const prodName = item?.productName ?? item?.product?.name ?? `Sản phẩm #${item?.productId ?? ''}`;
      const curProd = productMap.get(prodName) || {
        name: prodName,
        categoryName: catName,
        sold: 0,
        revenue: 0
      };
      curProd.sold += qty;
      curProd.revenue += lineTotal;
      productMap.set(prodName, curProd);
    }
  }

  const categoryStats = Array.from(categoryMap.values())
    .sort((a, b) => b.revenue - a.revenue)
    .map(c => ({
      name: c.name,
      soldText: `${c.sold} sản phẩm`,
      revenue: c.revenue
    }));

  const topProducts = Array.from(productMap.values())
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5)
    .map((p, idx) => ({
      rank: idx + 1,
      name: p.name,
      categoryName: p.categoryName,
      sold: p.sold,
      revenue: p.revenue
    }));

  return {
    revenueMonth,
    totalOrders,
    avgOrderValue,
    totalStock,
    categoryStats,
    topProducts
  };
}

async function loadRealDashboardStats() {
  try {
    const res = await apiClient.getDashboardStats();
    const data = unwrapRestResponse ? unwrapRestResponse(res) : res;
    if (data && typeof data === 'object') {
      return {
        revenueMonth: Number(data.revenueMonth ?? data.monthlyRevenue ?? 0),
        totalOrders: Number(data.totalOrders ?? data.orderCount ?? 0),
        avgOrderValue: Number(data.avgOrderValue ?? 0),
        totalStock: Number(data.totalStock ?? data.stockCount ?? 0),
        categoryStats: Array.isArray(data.categoryStats) ? data.categoryStats : [],
        topProducts: Array.isArray(data.topProducts) ? data.topProducts : []
      };
    }
  } catch (err) {
    // Nếu chưa có endpoint /dashboard/stats (404) thì tính trực tiếp từ orders + products thật
    if (err?.status !== 404) {
      console.warn('Fallback tính dashboard từ orders/products:', err?.message || err);
    }
  }

  const [ordersRes, productsRes] = await Promise.allSettled([
    apiClient.getOrders ? apiClient.getOrders({ current: 1, pageSize: 200 }) : Promise.resolve([]),
    apiClient.getProducts ? apiClient.getProducts({ current: 1, pageSize: 200 }) : Promise.resolve([])
  ]);

  const orders = ordersRes.status === 'fulfilled' ? extractList(ordersRes.value) : [];
  const products = productsRes.status === 'fulfilled' ? extractList(productsRes.value) : [];

  return buildStatsFromOrdersAndProducts(orders, products);
}

export async function initDashboardPage() {
  const allowed = mountAdminLayout('dashboard');
  if (!allowed) return;

  const content = document.getElementById('dashboard-content');
  if (!content) return;

  const stats = await loadRealDashboardStats();

  content.innerHTML = `
    <!-- Header Page -->
    <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-200 pb-4">
      <div>
        <h1 class="text-xl sm:text-2xl font-black text-slate-900 tracking-tight flex items-center gap-2.5">
          <i data-lucide="bar-chart-3" class="w-6 h-6 text-[#DC2626]"></i>
          <span>Thống Kê Doanh Thu & Báo Cáo Pha Hằng</span>
        </h1>
        <p class="text-xs text-slate-500 mt-1">
          Số liệu thống kê trực tiếp từ cơ sở dữ liệu hệ thống Pha Hằng
        </p>
      </div>

      <div class="flex items-center gap-2">
        <span class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white text-slate-700 text-xs font-semibold border border-slate-200 font-mono shadow-xs">
          <i data-lucide="calendar" class="w-4 h-4 text-[#DC2626]"></i>
          Kỳ Báo Cáo: Năm 2026
        </span>
      </div>
    </div>

    <!-- 4 Metric Cards -->
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <div class="p-5 rounded-2xl bg-white border border-slate-200 shadow-xs flex items-center justify-between">
        <div class="space-y-1">
          <div class="flex items-center gap-2">
            <span class="w-2 h-2 rounded-full bg-emerald-500"></span>
            <p class="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Doanh Thu</p>
          </div>
          <p class="text-xl xl:text-2xl font-black text-slate-900 font-mono mt-1 whitespace-nowrap">
            ${formatVND(stats.revenueMonth)}
          </p>
          <span class="text-[11px] text-slate-500 block font-mono">Đơn không bị hủy</span>
        </div>
        <div class="w-11 h-11 rounded-xl bg-red-50 text-[#DC2626] flex items-center justify-center border border-red-100 shadow-xs">
          <i data-lucide="dollar-sign" class="w-5 h-5"></i>
        </div>
      </div>

      <div class="p-5 rounded-2xl bg-white border border-slate-200 shadow-xs flex items-center justify-between">
        <div class="space-y-1">
          <div class="flex items-center gap-2">
            <span class="w-2 h-2 rounded-full bg-emerald-500"></span>
            <p class="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Tổng Đơn Hàng</p>
          </div>
          <p class="text-xl xl:text-2xl font-black text-slate-900 font-mono mt-1 whitespace-nowrap">
            ${stats.totalOrders} đơn
          </p>
          <span class="text-[11px] text-slate-500 block font-mono">Dữ liệu từ BE</span>
        </div>
        <div class="w-11 h-11 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center border border-emerald-100 shadow-xs">
          <i data-lucide="shopping-cart" class="w-5 h-5"></i>
        </div>
      </div>

      <div class="p-5 rounded-2xl bg-white border border-slate-200 shadow-xs flex items-center justify-between">
        <div class="space-y-1">
          <div class="flex items-center gap-2">
            <span class="w-2 h-2 rounded-full bg-amber-500"></span>
            <p class="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Giá Trị TB / Đơn</p>
          </div>
          <p class="text-xl xl:text-2xl font-black text-slate-900 font-mono mt-1 whitespace-nowrap">
            ${formatVND(stats.avgOrderValue)}
          </p>
          <span class="text-[11px] text-slate-500 block font-mono">Trung bình đơn hợp lệ</span>
        </div>
        <div class="w-11 h-11 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center border border-amber-100 shadow-xs">
          <i data-lucide="trending-up" class="w-5 h-5"></i>
        </div>
      </div>

      <div class="p-5 rounded-2xl bg-white border border-slate-200 shadow-xs flex items-center justify-between">
        <div class="space-y-1">
          <div class="flex items-center gap-2">
            <span class="w-2 h-2 rounded-full bg-red-500"></span>
            <p class="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Tồn Kho Điện Máy</p>
          </div>
          <p class="text-xl xl:text-2xl font-black text-slate-900 font-mono mt-1 whitespace-nowrap">
            ${stats.totalStock} chiếc
          </p>
          <span class="text-[11px] text-slate-500 block font-mono">Tổng tồn kho thực tế</span>
        </div>
        <div class="w-11 h-11 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center border border-slate-200 shadow-xs">
          <i data-lucide="box" class="w-5 h-5"></i>
        </div>
      </div>
    </div>

    <!-- 2 Bảng -->
    <div class="grid grid-cols-1 lg:grid-cols-12 gap-6">
      <div class="lg:col-span-7 bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-4">
        <h3 class="text-sm font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2 pb-2 border-b border-slate-100">
          <i data-lucide="pie-chart" class="w-4 h-4 text-[#DC2626]"></i>
          <span>Doanh Thu Theo Ngành Hàng</span>
        </h3>

        <div class="border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-100 text-xs">
          <div class="grid grid-cols-12 p-3 bg-slate-50 font-bold text-slate-500 uppercase tracking-wider text-[11px]">
            <span class="col-span-5">Ngành Hàng</span>
            <span class="col-span-3 text-center">Đã Bán</span>
            <span class="col-span-4 text-right">Doanh Thu</span>
          </div>
          ${stats.categoryStats.length > 0
            ? stats.categoryStats.map(c => `
                <div class="grid grid-cols-12 p-3 items-center">
                  <span class="col-span-5 font-bold text-slate-900">${esc(c.name)}</span>
                  <span class="col-span-3 text-center font-mono font-semibold">${esc(c.soldText || `${c.sold ?? 0} sản phẩm`)}</span>
                  <span class="col-span-4 text-right font-mono font-black text-[#DC2626]">${formatVND(c.revenue)}</span>
                </div>
              `).join('')
            : `<div class="p-6 text-center text-slate-400">Chưa có dữ liệu doanh thu theo ngành hàng từ BE.</div>`
          }
        </div>
      </div>

      <div class="lg:col-span-5 bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-4">
        <h3 class="text-sm font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2 pb-2 border-b border-slate-100">
          <i data-lucide="award" class="w-4 h-4 text-amber-500"></i>
          <span>Top Thiết Bị Bán Chạy Nhất</span>
        </h3>

        <div class="space-y-3 text-xs">
          ${stats.topProducts.length > 0
            ? stats.topProducts.map(p => `
                <div class="flex items-center justify-between p-2.5 rounded-xl border border-slate-100 hover:bg-slate-50 transition-colors">
                  <div class="flex items-center gap-3 min-w-0">
                    <span class="w-6 h-6 rounded-lg font-mono font-black text-xs flex items-center justify-center shrink-0 bg-slate-100 text-slate-700">
                      ${p.rank}
                    </span>
                    <div class="min-w-0">
                      <p class="font-bold text-slate-900 truncate">${esc(p.name)}</p>
                      <p class="text-[11px] text-slate-400 font-medium">${esc(p.categoryName)} · Đã bán ${p.sold} cái</p>
                    </div>
                  </div>
                  <span class="font-mono font-bold text-slate-900 text-right shrink-0">${formatVND(p.revenue)}</span>
                </div>
              `).join('')
            : `<div class="p-6 text-center text-slate-400 border border-dashed border-slate-200 rounded-xl">Chưa có dữ liệu sản phẩm bán chạy từ BE.</div>`
          }
        </div>
      </div>
    </div>
  `;

  window.lucide?.createIcons();
}

initDashboardPage();