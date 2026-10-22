// 鱼贴图清单的唯一来源。check-fish-textures.js / freeze-fish-baseline.js /
// check-hollow.js 都从这里读，避免三处各抄一份然后漂移。
//
// 顺序 = 创造栏展示顺序。
module.exports = [
  // ---- 第一批：台钓向 ----
  'crucian_carp', 'tilapia', 'mullet', 'grass_carp', 'black_carp',
  'banded_loach', 'hemiculter',
  // ---- 第一批：路亚向 ----
  'topmouth_culter', 'zander', 'sapphire_snakehead',
  'platinum_arowana', 'oxeye_tarpon',
  'atlantic_salmon', 'bluefin_tuna', 'juvenile_shark',
  // ---- 第二批：全部仅路亚 ----
  'striped_bass', 'pike', 'arapaima', 'tigerfish', 'brown_trout', 'mirror_carp',
  // ---- 第三批 5 种（用户 2026-10-01 指定）：4 台钓 + 1 路亚 ----
  'african_butterflyfish', 'north_african_catfish', 'jewel_cichlid', 'guppy', 'elephantnose',
  // ---- 第四批 2 种（用户 2026-10-02 指定）：洞穴专属台钓鱼、蓝紫档 ----
  'golden_loach', 'cave_blindfish',
  // ---- 第 1 批：冷水 5 条（用户 2026-10-08，docs/33 §9.2）----
  // 顺序 = 创造栏展示顺序（与 ModItems 里那五行 output.accept 一一对应）：
  // 先高寒湖两条，再冷水溪流三条。
  'arctic_char', 'whitefish', 'rainbow_trout', 'burbot', 'taimen',
  // ---- 第 3 批：极地 9 条（用户 2026-10-08，docs/33 §9.2）----
  // 冰鱼（icefish）用户明确不做 ✓ 不要加回来。
  // 顺序 = 创造栏展示顺序：先台钓三条、再紫金两条、最后金红三条（与 ModItems 的 output.accept 一一对应）
  'arctic_cod', 'capelin', 'atlantic_herring', 'wolffish', 'redfish',
  'sablefish', 'atlantic_cod', 'greenland_halibut', 'greenland_shark',
  // ---- 第 4 批：远洋 5 条（用户 2026-10-08 逐条定档）----
  // 顺序 = 创造栏展示顺序（与 ModItems 的 output.accept 一一对应）：
  // 深海两条 → 河湖入侵种 → 台钓巨鲤 → 沼泽电鳗
  'sailfish', 'mahi_mahi', 'alligator_gar', 'giant_siamese_carp', 'electric_eel',
];
