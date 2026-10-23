package com.whitecobalt.anglertackle.shop;

import com.whitecobalt.anglertackle.fishing.FishData;
import com.whitecobalt.anglertackle.registry.ModDataComponents;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.world.item.ItemStack;

import java.util.Set;

/**
 * 「这条鱼是不是还有用的材料」—— 卖鱼前的确认提示用它。
 *
 * <h2>为什么需要</h2>
 * 用户的原话："卖鱼应该在点击某几种特殊鱼时弹一个'你确定要卖掉这条鱼吗'，
 * 因为有可能手快点到兑换材料和评定材料。"
 *
 * <p>这不是过度设计：鱼是**唯一**能换鱼币的东西，而其中几种同时是
 * 等级评定（梭鲈）和兑换（大西洋鲑 / 褐鳟 / 虎鱼）的硬性材料。
 * 这些鱼通常钓很久才出一条，卖错一条的代价是几十分钟 —— 而卖鱼页是"点一下就卖"，
 * 手快是真的会点错。
 *
 * <h2>判定放在这里而不是散在界面里</h2>
 * 界面要知道"该不该弹框"，但"哪些算材料"是**规则**，跟着
 * {@link ShopCatalog}（兑换）和 {@link ShopManager#RATINGS}（评定）走。
 * 散在界面里的话，以后加一条兑换鱼就会忘记同步 —— 表现是"那条鱼被默默卖掉了"，
 * 而没人会去检查一个**没有弹出来的提示框**。
 * 所以 {@code tools/check-shop-ui.js} 会断言这里的三个集合和上面两处一致。
 */
public final class ShopMaterials {

    /**
     * 等级评定（突破）要的鱼 —— 四个评定点的材料全集。
     *
     * <p>⚠ 必须和 {@link com.whitecobalt.anglertackle.player.AnglerLeveling#GATES}
     * 里出现过的 fishId 一致，{@code tools/check-shop-ui.js} 会断言这件事。
     */
    private static final Set<String> RATING_FISH = Set.of(
            "zander", "mullet", "grass_carp", "juvenile_shark", "topmouth_culter");

    /**
     * 兑换要的鱼。
     *
     * <p>⚠ 必须和 {@link ShopCatalog} 里所有 {@code EXCHANGE} 条目的兑换物一致：
     * 金渔轮要红品质的大西洋鲑 / 褐鳟 / 虎鱼**各一条**。
     */
    private static final Set<String> EXCHANGE_FISH = Set.of(
            "atlantic_salmon", "brown_trout", "tigerfish");

    /**
     * 红色档位。
     *
     * <p>⚠ 这里原本写的是 {@code 6}（照"1=白…6=红"的错误口径），而品质只有 0~5 ——
     * 于是"这是红品质鱼，可以拿去兑换红鱼线"这条提示**从来没弹过**。
     * 同一个坑在 {@code ShopManager.RATINGS} 那边踩过一次（红鱼线兑换门槛写成 6，
     * 永远兑不出来）。一律用枚举序号推导，不写字面量。
     */
    private static final int RED_TIER = com.whitecobalt.anglertackle.item.Quality.RED.ordinal();

    private ShopMaterials() {
    }

    /**
     * 这条鱼如果被卖掉，会损失什么用途。返回 {@code null} = 普通鱼，可以直接卖。
     *
     * <p>用户 2026-10-02："卖鱼时提醒玩家下一级突破任务的鱼确定要卖吗。"
     * 所以**下一次评定**要交的鱼，提示语里会点名"下一次等级评定（Lv.N）"；
     * 更后面几级的材料也会提示，但只说"后面的评定要用"。
     *
     * @param level 玩家当前垂纶等级（客户端从 {@code ClientShopState} 拿）
     * @return 给玩家看的原因文案（比如"下一次等级评定（Lv.20）要交的鱼（梭鲈）"）
     */
    public static String warningFor(ItemStack stack, int level) {
        if (stack.isEmpty()) {
            return null;
        }
        String id = BuiltInRegistries.ITEM.getKey(stack.getItem()).getPath();
        FishData d = stack.get(com.whitecobalt.anglertackle.registry.ModDataComponents.FISH_DATA.get());
        int tier = d == null ? -1 : d.effectiveTier();
        String name = stack.getHoverName().getString();

        // ① 下一次评定要交的（用户点名的那一种提醒）
        int gate = com.whitecobalt.anglertackle.player.AnglerLeveling.nextGate(level);
        if (gate != 0 && matchesGate(id, tier, gate)) {
            return "这是 §e下一次等级评定（Lv." + gate + "）§r 要交的鱼（" + name + "）";
        }
        // ② 更后面几级的评定材料（也是"卖错了要重钓很久"的东西）
        if (RATING_FISH.contains(id) && isAnyGateMaterial(id, tier)) {
            return "这是 §e等级评定§r 后面要用到的鱼（" + name + "）";
        }
        // ③ 兑换材料
        if (EXCHANGE_FISH.contains(id)) {
            return "这是 §d兑换金渔轮§r 要用的鱼（" + name + "）";
        }
        if (tier >= RED_TIER) {
            // 红鱼线要"任意两条红品质鱼" —— 不限种类，所以每条红鱼都算
            return "这是 §c红品质§r 鱼，可以拿去 §d兑换红鱼线§r";
        }
        return null;
    }

    /** 这一条鱼满不满足某个评定点的要求（任一条要求满足即可）。 */
    public static boolean matchesGate(String fishId, int tier, int gateLevel) {
        for (var r : com.whitecobalt.anglertackle.player.AnglerLeveling.requirementsAt(gateLevel)) {
            if (r.fishId().equals(fishId) && tier >= r.minTier()) {
                return true;
            }
        }
        return false;
    }

    /** 四个评定点里有没有哪一条要求匹配这条鱼。 */
    private static boolean isAnyGateMaterial(String fishId, int tier) {
        for (int g : com.whitecobalt.anglertackle.player.AnglerLeveling.GATE_LEVELS) {
            if (matchesGate(fishId, tier, g)) {
                return true;
            }
        }
        return false;
    }

    /** 这条鱼是不是材料（不需要原因文案时用；等级未知按 1 算）。 */
    public static boolean isMaterial(ItemStack stack) {
        return warningFor(stack, 1) != null;
    }

    // ================================================================ 鱼 → 原版物品 兑换
    //
    // 用户 2026-10-02 加的兑换表（{@link ShopCatalog#EXCHANGES}）。
    // 判定放在这里而不是各写一份：**服务端**要用它决定能不能换，
    // **界面**要用它决定那一行是不是灰的 —— 两处各写一遍的话，
    // 迟早出现"界面显示能换、点了却说材料不够"（或者反过来）。

    /** 六个档位的中文名（0 起算，与 Quality 的枚举顺序一致）。 */
    private static final String[] TIER_CN = {"白", "绿", "蓝", "紫", "金", "红"};

    /**
     * 玩家背包里有没有够量的、符合品质要求的这种鱼。
     *
     * <p>品质取 {@link FishData#effectiveTier()}（**0 起算**）—— 与
     * {@code ShopManager} 扣材料时的判据**完全一致**，所以界面灰不灰与服务端收不收永远同步。
     */
    public static boolean has(net.minecraft.world.entity.player.Player player, ShopCatalog.Exchange x) {
        if (player == null) {
            return false;
        }
        int n = 0;
        for (int i = 0; i < player.getInventory().getContainerSize(); i++) {
            ItemStack s = player.getInventory().getItem(i);
            if (matches(s, x)) {
                n += s.getCount();
            }
        }
        return n >= x.fishCount();
    }

    /**
     * 鳄雀鳝的 item id —— 用户 2026-10-11（A4）：它**不做专门兑换** ✗，
     * 但"**可以替换任意其他兑换所需红鱼**" ✓（原话举例：金轮那条要红鱼 ⇒ 鳄雀鳝也算 ✓）。
     */
    private static final String GAR_ID = "alligator_gar";

    /** 一格物品算不算这条兑换要的鱼。 */
    public static boolean matches(ItemStack stack, ShopCatalog.Exchange x) {
        if (stack.isEmpty()) {
            return false;
        }
        String path = BuiltInRegistries.ITEM.getKey(stack.getItem()).getPath();
        FishData d = stack.get(ModDataComponents.FISH_DATA.get());
        if (d == null) {
            return false;
        }
        if (path.equals(x.fishId())) {
            return d.effectiveTier() >= x.minTier();
        }
        // ★ A4：鳄雀鳝顶替"任意兑换索要的红鱼"。
        //   ⚠ 只对**索要红档**（minTier >= 5）的兑换生效 ✗ —— 否则它就成了"万能鱼"：
        //     要绿档的兑换也能拿它顶，那不是"替换红鱼"，是"什么都能换" ✗。
        //   ⚠ 它必须**自己也是红档**（d.effectiveTier() >= 5 ✓）：鳄雀鳝是 P_G_R={紫,金,红}，
        //     紫档/金档的鳄雀鳝不算"红鱼" ✓。
        return x.minTier() >= 5 && GAR_ID.equals(path) && d.effectiveTier() >= 5;
    }

    /**
     * 兑换要求的文案，例如"§5紫§r品质以上 翘嘴 ×2"。
     *
     * <p>⚠ 颜色走模组自己的 {@code Quality} 配色（和鱼获 tooltip、图鉴同一份），
     * **别手写颜色码**：早先写的是 `"§" + "789abc".charAt(t)`，而 MC 的颜色码是
     * 7 灰 / 8 深灰 / 9 蓝 / a 绿 / b 青 / c 红 —— 于是白=灰、绿=深灰、紫=绿、金=青，
     * 整列都不对。用户 2026-10-02："不止金品的颜色有问题。"
     *
     * @param dim 材料不够时整行变暗（界面用），文案里不要这句话（聊天提示用）
     */
    public static String describe(ShopCatalog.Exchange x, boolean dim) {
        int t = Math.max(0, Math.min(TIER_CN.length - 1, x.minTier()));
        String body = dim ? "§8" : "§f";
        String color = com.whitecobalt.anglertackle.item.Quality.of(t).color().toString();
        return body + color + TIER_CN[t] + body + "品质 "
                + fishName(x.fishId()) + " ×" + x.fishCount();
    }

    /** 不带变暗的版本（聊天提示用）。 */
    public static String describe(ShopCatalog.Exchange x) {
        return describe(x, false);
    }

    /** 产出物品的显示名（原版物品走它自己的语言键，不用我们配）。 */
    public static String resultName(net.minecraft.world.entity.player.Player player, ShopCatalog.Exchange x) {
        ItemStack out = resultStack(player, x);
        return out.isEmpty() ? x.resultId() : out.getHoverName().getString();
    }

    /**
     * 构造产出物品（含附魔）。
     *
     * <p>⚠ 附魔书不是普通物品 —— 附魔要写进 {@code stored_enchantments} 组件。
     * 这里直接用 {@code ItemStack.enchant(...)}：它内部走
     * {@code EnchantmentHelper.updateEnchantments} → {@code getComponentType(stack)}，
     * 而后者对 {@code Items.ENCHANTED_BOOK} 返回的正是 {@code STORED_ENCHANTMENTS}
     * （普通物品则是 {@code ENCHANTMENTS}）—— 所以用它写附魔书是**原版同款**做法。
     * 前提是产出的 item 必须是 {@code minecraft:enchanted_book}（生成器会断言这一条，
     * 用户 2026-10-02 明确："兑换附魔特指附魔书"）。
     *
     * <p>⚠ 附魔**不在 {@code BuiltInRegistries} 里**：1.21 的附魔是数据驱动注册表，
     * 只能从 {@code RegistryAccess} 查（写 BuiltInRegistries.ENCHANTMENT 编译期就找不到符号）。
     * 查不到就返回空栈，调用方会提示"产出物品不存在"，**不会白扣鱼**。
     */
    public static ItemStack resultStack(net.minecraft.world.entity.player.Player player,
                                        ShopCatalog.Exchange x) {
        var id = net.minecraft.resources.Identifier.tryParse(x.resultId());
        if (id == null) {
            return ItemStack.EMPTY;
        }
        var item = BuiltInRegistries.ITEM.get(id);
        if (item == null || item == net.minecraft.world.item.Items.AIR) {
            return ItemStack.EMPTY;
        }
        ItemStack out = new ItemStack(item, Math.max(1, x.resultCount()));
        // ★ 用户 2026-10-11（A3）：兑换**熏鱼**必须"数据一致才能堆叠" ——
        //   熏鱼带着 FISH_CHUNK（鱼种 / 档位 / 重量）⇒ 16 个里只要有一项不同就会分成 16 摞 ✗。
        //   所以这里用兑换表里的**固定值**构造（与玩家交上来的那条鱼无关 ✓），
        //   一次兑换出来的就是一整组 ✓。
        if (x.fixedFishData()) {
            out.set(com.whitecobalt.anglertackle.registry.ModDataComponents.FISH_CHUNK.get(),
                    new com.whitecobalt.anglertackle.fishing.FishChunkData(
                            x.fixedSpecies(), x.fixedTier(), x.fixedWeightKg()));
        }
        if (x.enchanted()) {
            var eid = net.minecraft.resources.Identifier.tryParse(x.enchant());
            if (eid == null || player == null) {
                return ItemStack.EMPTY;
            }
            var key = net.minecraft.resources.ResourceKey.create(
                    net.minecraft.core.registries.Registries.ENCHANTMENT, eid);
            var holder = player.level().registryAccess()
                    .registryOrThrow(net.minecraft.core.registries.Registries.ENCHANTMENT)
                    .getHolder(key);
            if (holder.isEmpty()) {
                return ItemStack.EMPTY;
            }
            out.enchant(holder.get(), Math.max(1, x.enchantLevel()));
        }
        return out;
    }

    /** 鱼种 id → 中文名（走物品显示名，和鱼获 tooltip、图鉴同一份）。 */
    public static String fishName(String fishId) {
        var sp = com.whitecobalt.anglertackle.fishing.FishSpecies.byId(fishId);
        if (sp == null) {
            return fishId;
        }
        return new ItemStack(sp.item().get()).getHoverName().getString();
    }
}
