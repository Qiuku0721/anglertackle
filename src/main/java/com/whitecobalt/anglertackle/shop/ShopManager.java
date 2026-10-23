package com.whitecobalt.anglertackle.shop;

import com.whitecobalt.anglertackle.fishing.FishData;
import com.whitecobalt.anglertackle.network.ModNetwork;
import com.whitecobalt.anglertackle.network.ShopSyncPayload;
import com.whitecobalt.anglertackle.player.FishermanData;
import com.whitecobalt.anglertackle.player.FishermanProgress;
import com.whitecobalt.anglertackle.player.PlayerData;
import com.whitecobalt.anglertackle.registry.ModDataComponents;
import com.whitecobalt.anglertackle.registry.ModItems;
import net.minecraft.ChatFormatting;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.Identifier;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;

import java.util.ArrayList;
import java.util.List;

/**
 * 商店的**服务端权威逻辑**：买、兑换、等级评定。
 *
 * <h2>一条铁律</h2>
 * 客户端只发"我想买 X"。**价格、解锁档位、限购、兑换要求全部在这里现查**
 * （数据源是 {@link ShopCatalog}）。客户端发来的任何数量/价格都不采信 ——
 * 否则改一个包就能一块钱买合金竿。
 *
 * <h2>为什么不用 AbstractContainerMenu</h2>
 * 这个商店**没有槽位**：不是把物品拖进拖出，而是"点一下 → 扣钱 → 发物品"。
 * 用 Menu 要多写一个容器、一套槽位同步、还要防刷（玩家往槽里塞东西）——
 * 全是白费的复杂度。等以后要做"把鱼卖给老柯"（那个确实需要槽位）再上 Menu。
 */
public final class ShopManager {

    private ShopManager() {
    }

    // ================================================================ 品质档位常量
    //
    // 一律由 Quality 的枚举序号推导，**不写字面量**。
    //
    // 写死数字的代价（2026-10-01 用户实测反馈）：
    //   "红品质线貌似无法兑换，即使背包里有两条红鱼"。根因就是兑换门槛写成了 6
    //   （照"1=白…6=红"的错误口径），而品质其实只有 0~5 —— `tier >= 6` 永远不成立。
    //   同一个 6 也在金渔轮（三种各一条红鱼）那条路上，所以两个兑换一起废了。
    //   编译通过、数字看着也"合法"，只有把门槛和枚举对起来量一次才会露馅。
    private static final int TIER_GREEN = com.whitecobalt.anglertackle.item.Quality.GREEN.ordinal();
    private static final int TIER_BLUE = com.whitecobalt.anglertackle.item.Quality.BLUE.ordinal();
    private static final int TIER_PURPLE = com.whitecobalt.anglertackle.item.Quality.PURPLE.ordinal();
    private static final int TIER_GOLD = com.whitecobalt.anglertackle.item.Quality.GOLD.ordinal();
    private static final int TIER_RED = com.whitecobalt.anglertackle.item.Quality.RED.ordinal();

    /**
     * 等级评定的交付要求表**已经不在这里**（2026-10-02）：
     * 垂纶等级改成 1–50、每 10 级一次突破之后，材料表搬到了
     * {@link com.whitecobalt.anglertackle.player.AnglerLeveling#GATES}
     * （按**等级**索引：10/20/30/40，一级可能要多条鱼），
     * 界面文案也从那张表生成 —— 两处各写一份的话迟早"界面说要梭鲈、实际收别的"。
     */

    /** 用户定的拒绝提示，原话照抄。 */
    private static final String REJECT = "品质或种类不满足要求";

    // ================================================================ 打开 / 同步
    public static void open(ServerPlayer player) {
        sync(player);
    }

    /** 把商店状态推给客户端（打开时、每次交易后都要发）。 */
    public static void sync(ServerPlayer player) {
        FishermanProgress p = FishermanData.get(player);
        long now = player.level().getGameTime();

        StringBuilder sb = new StringBuilder();
        for (ShopCatalog.Entry e : ShopCatalog.ENTRIES) {
            if (!e.limited()) {
                continue;
            }
            long wait = p.restockWait(e.id(), now);
            if (wait > 0) {
                if (sb.length() > 0) {
                    sb.append(';');
                }
                // 换算成分钟（向上取整：还剩 1 秒也该显示"1 分钟"而不是"0 分钟"）
                sb.append(e.id()).append(':').append((wait + 1199L) / 1200L);
            }
        }
        // 联赛标记（`<届号>|<规模>`）：屏幕上的「纪念称号」是带参数的模板名（`S%s%s联赛纪念`），
        // 客户端不知道第几届就画不出名字（会把 %s 原样画出来）。读不到就当"还没开赛" ✓
        String leagueTag = "";
        try {
            com.whitecobalt.anglertackle.league.LeagueData ld =
                    com.whitecobalt.anglertackle.league.LeagueData.get(player.serverLevel());
            if (ld.seasonNo > 0 && ld.tierId != null && !ld.tierId.isEmpty()) {
                leagueTag = ld.seasonNo + "|" + ld.tierId;
            }
        } catch (Throwable ignored) {
            // 联赛坏了也绝不影响打开商店 ✓
        }
        ModNetwork.sendTo(player, new ShopSyncPayload(p.stage(), p.level(), p.xp(),
                p.talked(), sb.toString(), leagueTag));
    }

    // ================================================================ 入口
    public static void handle(ServerPlayer player, String entryId) {
        if (entryId.isEmpty()) {
            open(player);
            return;
        }
        if (entryId.equals(com.whitecobalt.anglertackle.network.ShopActionPayload.OP_RATE)) {
            rate(player);
            return;
        }
        if (entryId.startsWith(com.whitecobalt.anglertackle.network.ShopActionPayload.OP_SELL_PREFIX)) {
            try {
                sell(player, Integer.parseInt(entryId.substring(
                        com.whitecobalt.anglertackle.network.ShopActionPayload.OP_SELL_PREFIX.length())));
            } catch (NumberFormatException e) {
                msg(player, "§c槽位号看不懂", true);
            }
            return;
        }
        if (entryId.startsWith(com.whitecobalt.anglertackle.network.ShopActionPayload.OP_REPAIR_PREFIX)) {
            try {
                repair(player, Integer.parseInt(entryId.substring(
                        com.whitecobalt.anglertackle.network.ShopActionPayload.OP_REPAIR_PREFIX.length())));
            } catch (NumberFormatException e) {
                msg(player, "§c槽位号看不懂", true);
            }
            return;
        }
        if (entryId.startsWith(com.whitecobalt.anglertackle.network.ShopActionPayload.OP_EXCHANGE_PREFIX)) {
            try {
                exchangeFish(player, Integer.parseInt(entryId.substring(
                        com.whitecobalt.anglertackle.network.ShopActionPayload.OP_EXCHANGE_PREFIX.length())));
            } catch (NumberFormatException e) {
                msg(player, "§c兑换编号看不懂", true);
            }
            return;
        }
        // 联赛商店（`docs/39` P4）：报价用下标寻址（客户端只发下标，价格/限购一律服务端现查 ✓）
        if (entryId.startsWith(com.whitecobalt.anglertackle.network.ShopActionPayload.OP_LEAGUE_PREFIX)) {
            try {
                buyLeague(player, Integer.parseInt(entryId.substring(
                        com.whitecobalt.anglertackle.network.ShopActionPayload.OP_LEAGUE_PREFIX.length())));
            } catch (NumberFormatException e) {
                msg(player, "§c报价编号看不懂", true);
            }
            return;
        }
        ShopCatalog.Entry e = byId(entryId);
        if (e == null) {
            msg(player, "§c没有这件商品", true);
            return;
        }
        buy(player, e);
    }

    /**
     * 买一条**联赛商店**报价（`docs/39` §4，P4）。
     *
     * <h2>顺序不能反</h2>
     * ① 查本届限购 → ② **先扣积分**（扣不动就整笔拒绝）→ ③ 发货 → ④ 记账。
     * 反过来（先发货再扣分）在并发/异常时会"白拿" ✗ —— 与 {@link #buy} 里
     * "扣钱成功之后才走发货"是同一条纪律（`docs/39` §8.2 有对应断言）。
     *
     * <h2>发货为什么不用 {@link #give(ServerPlayer, ShopCatalog.Entry)}</h2>
     * 那个只会 `new ItemStack` 且**硬编码 `anglertackle:` 命名空间**，发不出附魔书、
     * 发不出固定品质的鱼、也发不出原版物资 ✗。
     * 所以这里**把报价拼成一个 {@code Exchange}** 交给 {@link ShopMaterials#resultStack} ——
     * 那是"用鱼换东西"已经在用的那条路（附魔在上面第 247 行、固定鱼数据在第 242 行）⇒
     * **加商品仍然是同一套逻辑** ✓（用户 2026-10-13 原话："老柯商店之前加商品不是有代码吗，我觉得都一个逻辑"）。
     */
    private static void buyLeague(ServerPlayer player, int index) {
        List<ShopCatalog.LeagueOffer> list = ShopCatalog.LEAGUE_OFFERS;
        if (index < 0 || index >= list.size()) {
            msg(player, "§c没有这条报价", true);
            return;
        }
        ShopCatalog.LeagueOffer o = list.get(index);
        com.whitecobalt.anglertackle.league.LeagueData d =
                com.whitecobalt.anglertackle.league.LeagueData.get(player.serverLevel());
        int season = Math.max(1, d.seasonNo);

        // ① 每届限购（世界侧；届号写在计数键里 ⇒ 新一届天然刷新，**不需要任何"重置"代码** ✓）
        if (o.limited()) {
            int bought = d.leagueBoughtOf(season, player.getUUID(), o.id());
            if (bought >= o.limitPerSeason()) {
                msg(player, "§c本届已经买过 " + bought + "/" + o.limitPerSeason()
                        + " —— 下一届联赛刷新后可以再买", true);
                return;
            }
        }
        // ② 先扣分
        if (!com.whitecobalt.anglertackle.league.LeaguePoints.spend(player, o.points())) {
            msg(player, "§c联赛积分不够（要 " + o.points() + "，你有 "
                    + com.whitecobalt.anglertackle.league.LeaguePoints.balance(player) + "）", true);
            return;
        }
        // ③ 发货（产物拼成 Exchange ⇒ 走现成那条路）
        if (!o.resultId().isEmpty() && o.resultCount() > 0) {
            ShopCatalog.Exchange ex = new ShopCatalog.Exchange("", 0, 0, o.resultId(),
                    o.resultCount(), o.enchant(), o.enchantLevel(), o.fixedSpecies(), o.fixedTier(),
                    o.fixedWeightKg());
            give(player, ShopMaterials.resultStack(player, ex), o.resultId());
        }
        // ④ 称号（纪念）：生成式实例，带**赛季号**与本期规模（P3 的机制 ✓）
        if (!o.titleTemplate().isEmpty()) {
            com.whitecobalt.anglertackle.title.Titles.grant(player,
                    com.whitecobalt.anglertackle.title.TitleDefs.instanceId(
                            o.titleTemplate(), season, d.tierId));
        }
        // ⑤ 记账（先扣分后记账：扣分失败上面已经 return，走不到这里 ✓）
        d.leagueAddBought(season, player.getUUID(), o.id());
        d.setDirty();
        com.whitecobalt.anglertackle.AnglersTackle.LOGGER.info(
                "[垂纶] 联赛商店：{} 花 {} 积分买了 {}（S{}）",
                player.getName().getString(), o.points(), o.id(), season);
        msg(player, "§a已购买 " + o.id() + "（-" + o.points() + " 积分）", false);
        sync(player);
    }

    private static ShopCatalog.Entry byId(String id) {
        for (ShopCatalog.Entry e : ShopCatalog.ENTRIES) {
            if (e.id().equals(id)) {
                return e;
            }
        }
        return null;
    }

    // ================================================================ 购买
    private static void buy(ServerPlayer player, ShopCatalog.Entry e) {
        FishermanProgress p = FishermanData.get(player);
        long now = player.level().getGameTime();

        // ① 解锁了吗
        if (!p.unlocked(e.unlockStage())) {
            msg(player, "§c老柯还不肯卖给你（需要等级 " + e.unlockStage() + "）", true);
            sync(player);
            return;
        }

        // ② 限购
        if (!p.canBuy(e.id(), e.stockPer(), e.restockMinutes(), now)) {
            long wait = p.restockWait(e.id(), now);
            p = p.resetIfRestocked(e.id(), now);
            FishermanData.set(player, p);
            if (p.canBuy(e.id(), e.stockPer(), e.restockMinutes(), now)) {
                // 刚好在这一刻补货了，继续走购买流程
            } else {
                msg(player, "§c这件卖完了，还要等 " + ((wait + 1199L) / 1200L) + " 分钟", true);
                sync(player);
                return;
            }
        }

        // ③ 付账
        switch (e.kind()) {
            case FREE -> {
                // 白送（麻线、手线轮、鱼钩）
            }
            case BUY -> {
                long coins = PlayerData.get(player).coins();
                if (coins < e.price()) {
                    msg(player, "§c鱼币不够（要 " + e.price() + "，你有 " + coins + "）", true);
                    sync(player);
                    return;
                }
                PlayerData.update(player, d -> d.withCoins(coins - e.price()));
                ModNetwork.syncCoins(player);
            }
            case EXCHANGE -> {
                if (!consumeExchange(player, e)) {
                    msg(player, "§c兑换材料不够：" + describeExchange(e), true);
                    sync(player);
                    return;
                }
            }
        }

        // ④ 发货 + 记账（扣钱成功之后才走这里 —— 顺序反了会出现"白拿"）
        give(player, e);
        FishermanData.set(player, FishermanData.get(player)
                .afterBuy(e.id(), e.stockPer(), e.restockMinutes(), now));
        sync(player);
    }

    /**
     * 扣兑换材料。够了就扣掉并返回 true；不够返回 false 且**什么都不扣**。
     *
     * <p>"先全部检查再扣"是刻意的：边查边扣的话，红鱼线要 2 条红鱼，
     * 玩家只有 1 条时会把那 1 条扣掉然后失败 —— 白吃一条鱼。
     */
    private static boolean consumeExchange(ServerPlayer player, ShopCatalog.Entry e) {
        String spec = e.exchange();
        int at = spec.indexOf('@');
        String fishPart = at < 0 ? spec : spec.substring(0, at);
        String rest = at < 0 ? "" : spec.substring(at);

        // ⚠ 生成器只在有品质或 @each 时才补 '@'；anyRedx2 这种是**没有分隔符**的，
        //   数量直接贴在鱼名后面。不补这一条的话，整串会被当成鱼种 id 去查语言键，
        //   查不到就原样显示 —— 表现就是用户看到的"鱼线兑换显示的是鱼英文"。
        if (at < 0) {
            int xi = fishPart.lastIndexOf('x');
            if (xi > 0 && fishPart.substring(xi + 1).matches("\\d+")) {
                rest = fishPart.substring(xi);
                fishPart = fishPart.substring(0, xi);
            }
        }
        int xi = rest.indexOf('x');
        int count = xi < 0 ? 1 : Integer.parseInt(rest.substring(xi + 1).replace("@each", ""));
        boolean red = rest.contains("@RED");
        boolean each = rest.contains("@each");

        if (fishPart.equals("anyRed")) {
            return consumeAny(player, null, TIER_RED, count);
        }
        String[] ids = fishPart.split("\\+");
        if (each) {
            // 三种各一条：先确认三种都有，再一起扣
            for (String id : ids) {
                if (countOf(player, id, red ? TIER_RED : 0) < 1) {
                    return false;
                }
            }
            for (String id : ids) {
                takeOne(player, id, red ? TIER_RED : 0);
            }
            return true;
        }
        return consumeAny(player, ids[0], red ? TIER_RED : 0, count);
    }

    /** 收走 {@code count} 条满足条件的鱼（{@code fishId == null} 表示不限种类）。 */
    private static boolean consumeAny(ServerPlayer player, String fishId, int minTier, int count) {
        if (countOf(player, fishId, minTier) < count) {
            return false;
        }
        int left = count;
        for (int i = 0; i < player.getInventory().getContainerSize() && left > 0; i++) {
            ItemStack s = player.getInventory().getItem(i);
            if (matches(s, fishId, minTier)) {
                s.shrink(1);
                left--;
            }
        }
        return true;
    }

    private static void takeOne(ServerPlayer player, String fishId, int minTier) {
        for (int i = 0; i < player.getInventory().getContainerSize(); i++) {
            ItemStack s = player.getInventory().getItem(i);
            if (matches(s, fishId, minTier)) {
                s.shrink(1);
                return;
            }
        }
    }

    private static int countOf(ServerPlayer player, String fishId, int minTier) {
        int n = 0;
        for (int i = 0; i < player.getInventory().getContainerSize(); i++) {
            ItemStack s = player.getInventory().getItem(i);
            if (matches(s, fishId, minTier)) {
                n += s.getCount();
            }
        }
        return n;
    }

    /**
     * 这条鱼符不符合要求。
     *
     * <p>品质取 {@link FishData#effectiveTier()}。**0 起算：0=白 … 5=红**（别再照 1 起算写，
     * 那正是"有两条红鱼却兑不出红鱼线"的原因）。
     * 用 effectiveTier 而不是 grade —— 后者只有 5 档，金和红会塌成同一档，
     * 那样"红品质"的兑换要求就会被金鱼满足。
     *
     * <p>⚠ 这里是 {@code >=}（**以上**）：用户 2026-10-02 明确
     * "评定需要确认能宽泛提交，比如要求绿色梭鲈的话更高级的梭鲈也可以替代提交"。
     * 改成 {@code ==} 会让"手上只有蓝梭鲈"的玩家交不了 Lv.10 的评定，
     * 而界面上写的是"绿品质**以上**"—— 文案与判定必须同口径。
     */
    private static boolean matches(ItemStack s, String fishId, int minTier) {
        if (s.isEmpty()) {
            return false;
        }
        FishData d = s.get(ModDataComponents.FISH_DATA.get());
        if (d == null) {
            return false;
        }
        if (fishId != null) {
            Identifier key = BuiltInRegistries.ITEM.getKey(s.getItem());
            if (!key.getPath().equals(fishId)) {
                return false;
            }
        }
        return d.effectiveTier() >= minTier;
    }

    private static void give(ServerPlayer player, ShopCatalog.Entry e) {
        Item item = BuiltInRegistries.ITEM.get(
                Identifier.fromNamespaceAndPath("anglertackle", e.id()));
        if (item == null || item == net.minecraft.world.item.Items.AIR) {
            msg(player, "§c商品注册表里找不到 " + e.id() + "（这是 bug，请反馈）", false);
            return;
        }
        give(player, new ItemStack(item), e.id());
    }

    // ================================================================ 鱼 → 原版物品 兑换
    /**
     * 兑换表里的第 {@code index} 条（{@link ShopCatalog#EXCHANGES}，用户 2026-10-02 定）。
     *
     * <p>顺序与买/卖一致，铁律也一样：
     * <ol>
     *   <li><b>先全部检查再扣</b>：材料不够时什么都不扣（边查边扣会让玩家白丢鱼）。</li>
     *   <li><b>产出也先构造好</b>：物品 id 或附魔 id 写错时直接报错返回，绝不先扣鱼 ——
     *       否则就是"鱼没了、东西也没到手"。</li>
     *   <li><b>服务端现查目录</b>：客户端只报下标，要几条 / 什么品质 / 给什么都在这里查。</li>
     * </ol>
     */
    private static void exchangeFish(ServerPlayer player, int index) {
        if (index < 0 || index >= ShopCatalog.EXCHANGES.size()) {
            msg(player, "§c没有这条兑换", true);
            return;
        }
        ShopCatalog.Exchange x = ShopCatalog.EXCHANGES.get(index);

        if (!ShopMaterials.has(player, x)) {
            msg(player, "§c兑换材料不够：" + ShopMaterials.describe(x), true);
            sync(player);
            return;
        }
        ItemStack out = ShopMaterials.resultStack(player, x);
        if (out.isEmpty()) {
            msg(player, "§c产出物品不存在（这是 bug，请反馈）：" + x.resultId()
                    + (x.enchanted() ? " + " + x.enchant() : ""), false);
            return;
        }
        consumeAny(player, x.fishId(), x.minTier(), x.fishCount());
        give(player, out, out.getHoverName().getString());
        msg(player, "§a兑换成功：" + ShopMaterials.describe(x) + " §7→ §f"
                + out.getCount() + "× " + out.getHoverName().getString(), true);
        sync(player);
    }

    /** 给物品；背包满了就掉在脚下（不能凭空吞掉玩家花钱买的东西）。 */
    private static void give(ServerPlayer player, ItemStack stack, String label) {
        if (!player.getInventory().add(stack)) {
            player.drop(stack, false);
            msg(player, "§e背包满了，" + label + " 掉在你脚下", true);
        }
    }

    // ================================================================ 卖鱼
    /**
     * 卖掉背包第 {@code slot} 格里的**一条**鱼。
     *
     * <p>三条铁律：
     * <ol>
     *   <li><b>价格现算</b>：读那一格实际的 {@code FishData}（含真实档位和体重），
     *       调 {@code FishItem.sellValue}。不信客户端报的任何数字。</li>
     *   <li><b>槽位要验</b>：客户端可以报任意槽位号，必须确认那一格真的是鱼 ——
     *       否则可以拿一根合金竿来"卖"。</li>
     *   <li><b>一次只卖一条</b>：一摞 16 条点一下全没了很难受，而且没法反悔。
     *       想全卖就多点几下。</li>
     * </ol>
     */
    public static void sell(ServerPlayer player, int slot) {
        if (slot < 0 || slot >= player.getInventory().getContainerSize()) {
            msg(player, "§c槽位越界", true);
            return;
        }
        ItemStack s = player.getInventory().getItem(slot);
        if (s.isEmpty() || !(s.getItem() instanceof com.whitecobalt.anglertackle.item.FishItem fi)) {
            msg(player, "§c这一格不是鱼", true);
            return;
        }
        long price = fi.sellValue(s);
        String name = s.getHoverName().getString();
        int left = s.getCount() - 1;
        s.shrink(1);

        PlayerData.update(player, d -> d.addCoins(price));
        ModNetwork.syncCoins(player);
        msg(player, "§a卖出 §f" + name + " §a→ §6+" + String.format("%,d", price)
                + " §a鱼币" + (left > 0 ? "§7（这摞还剩 " + left + "）" : ""), false);
        sync(player);
    }

    // ================================================================ 等级评定（突破）
    /**
     * 交付评定材料，突破到下一级。
     *
     * <p>用户 2026-10-02 的规则：等级停在 10/20/30/40 时经验不积攒，
     * 交了材料才"突破到下一级"；40 级那次做完之后**不会再有评定任务**。
     * 材料表在 {@link com.whitecobalt.anglertackle.player.AnglerLeveling#GATES}，
     * 界面文案也从那里生成 —— 两边各写一份的话迟早"界面说要梭鲈、实际收别的"。
     */
    private static void rate(ServerPlayer player) {
        FishermanProgress p = FishermanData.get(player);
        int gate = com.whitecobalt.anglertackle.player.AnglerLeveling.nextGate(p.level());
        if (gate == 0 || !p.atGate()) {
            // 不在评定点上：要么没到，要么已经突破完了
            msg(player, p.level() >= 41
                    ? "§a老柯说：评定都做完了，剩下的路你自己走。"
                    : "§e老柯说：还没到评定的时候（下一个评定在 Lv." + gate + "）", false);
            return;
        }
        List<com.whitecobalt.anglertackle.player.AnglerLeveling.Requirement> need =
                com.whitecobalt.anglertackle.player.AnglerLeveling.requirementsAt(gate);
        if (need.isEmpty()) {
            msg(player, "§c这一档没有评定配置（这是 bug，请反馈）", false);
            return;
        }

        // 材料够不够（缺哪条都说清楚，不要只说一句"不满足"）
        List<String> lack = new ArrayList<>();
        for (var r : need) {
            if (countOf(player, r.fishId(), r.minTier()) < r.count()) {
                lack.add(com.whitecobalt.anglertackle.player.AnglerLeveling.describe(r));
            }
        }
        if (!lack.isEmpty()) {
            // 用户定的文案，原话照抄（前半句）
            msg(player, "§c老柯摇了摇头：" + REJECT + "§7（还差 " + String.join("§7、", lack) + "§7）", false);
            return;
        }

        // 交付物**消耗**（用户定案："不能反复交，消耗"）
        for (var r : need) {
            consumeAny(player, r.fishId(), r.minTier(), r.count());
        }

        int before = p.level();
        FishermanData.set(player, p.breakthrough());
        int after = FishermanData.get(player).level();

        msg(player, "§a老柯点了点头。你的垂纶等级突破到 §fLv." + after + " §a！"
                + "§7（原 Lv." + before + "，商店解锁档位 "
                + FishermanData.get(player).stage() + "）", false);

        // 评定通过的**通知信**（`docs/36` §4.1 第 4 条；2026-10-12 邮件的 M4 改造）。
        //
        // ⚠ 位置很重要：必须在**材料检查之后、突破成功之后**发 —— 放到前面去的话，
        //   每次被老柯拒绝（"品质或种类不满足要求"）都会白寄一封信 ✗。
        // ⚠ 只发通知、**不带附件**（doc 原话"无（或小额饵料）"）：没有附件就没有
        //   "邮箱满 ⇒ 奖励丢失"的问题；满箱时只是这封信没寄出去，其余一切照旧 ✓。
        // ⚠ 10 级那根铁质路亚竿仍然**当场塞手里**（那是"老柯塞给你"的剧情动作，不是邮件奖励）。
        try {
            com.whitecobalt.anglertackle.mail.MailService.deliver(player, "level_gate",
                    java.util.List.of(String.valueOf(after),
                            String.valueOf(FishermanData.get(player).stage()),
                            String.valueOf(before)),
                    0L, java.util.List.of());
        } catch (Throwable t) {
            // 邮件坏了绝不许影响评定本身（玩家材料已经交了）
            com.whitecobalt.anglertackle.AnglersTackle.LOGGER.warn(
                    "[垂纶] 评定通知信投递失败（已忽略）：{}", t.toString());
        }

        // 第 1 次评定（10 级突破）额外送一根铁质路亚竿（用户定案：
        // "绿档（第 2 档）评定完额外送一根绿路亚竿"——第 2 档就是突破 10 级之后）
        if (before == 10) {
            give(player, new ItemStack(ModItems.IRON_LURE_ROD.get()), "绿路亚竿");
            msg(player, "§6老柯塞给你一根 §f铁质路亚竿§6：「拿着，试试这个。」", false);
        }
        // 40 级那次做完，提示"后面没有评定了"
        if (before == 40) {
            msg(player, "§7（之后不会再有评定任务了 —— 一路钓到 Lv.50 吧）", false);
        }
        sync(player);
    }

    /**
     * 第一次对话结束时的赠品 + 开店。
     *
     * <p>用户定案："白找老柯第一次对话完免费给一根台钓一根路亚"，
     * 并且"第一次对话结束后开启右键点开钓鱼商店功能"。
     * **幂等**：{@code talked} 已经是 true 就直接返回，反复右键不会反复送。
     */
    public static void onFirstTalk(ServerPlayer player) {
        FishermanProgress p = FishermanData.get(player);
        if (p.talked()) {
            return;
        }
        FishermanData.set(player, p.withTalked());
        give(player, new ItemStack(ModItems.WOOD_FLOAT_ROD.get()), "木台钓竿");
        give(player, new ItemStack(ModItems.WOOD_LURE_ROD.get()), "木路亚竿");
        msg(player, "§6老柯：「第一次来？这两根竿拿去用。」", false);
        msg(player, "§7（现在可以 §f右键老柯 §7打开钓鱼商店了）", false);
    }

    /**
     * 修杆：把一根竿的耐久补满，收费 = 目录价的 **25%**
     * （用户 2026-10-02："修复鱼竿耗费的鱼币从物品价值的 50% 变化为 25%"）；兑换竿固定 5000。
     *
     * <p>服务端权威：只认**背包槽位号**，价格与"这是不是一根竿"都在这里重新判一遍 ——
     * 客户端算的那份只用来显示，改包改不动价格。
     */
    public static final int REPAIR_EXCHANGE_COST = 5000;

    /** 修复收费占目录价的比例（25%）。 */
    public static final int REPAIR_PERCENT = 25;

    /** 这根竿修一次要多少币。返回 -1 表示"不是竿"或"没坏"。 */
    public static int repairCost(ItemStack stack) {
        if (!(stack.getItem() instanceof com.whitecobalt.anglertackle.item.RodItem)) {
            return -1;
        }
        if (stack.getDamageValue() <= 0) {
            return -1;
        }
        net.minecraft.resources.Identifier id =
                net.minecraft.core.registries.BuiltInRegistries.ITEM.getKey(stack.getItem());
        for (ShopCatalog.Entry e : ShopCatalog.ENTRIES) {
            if (e.id().equals(id.getPath())) {
                return e.kind() == ShopCatalog.Kind.EXCHANGE
                        ? REPAIR_EXCHANGE_COST
                        : Math.max(1, e.price() * REPAIR_PERCENT / 100);
            }
        }
        return REPAIR_EXCHANGE_COST;
    }

    private static void repair(ServerPlayer player, int slot) {
        if (slot < 0 || slot >= player.getInventory().getContainerSize()) {
            return;
        }
        ItemStack stack = player.getInventory().getItem(slot);
        int cost = repairCost(stack);
        if (cost < 0) {
            msg(player, "§c这根竿不需要修（或者那不是竿）。", true);
            return;
        }
        long coins = PlayerData.get(player).coins();
        if (coins < cost) {
            msg(player, "§c鱼币不够（修这根要 " + cost + "，你有 " + coins + "）", true);
            return;
        }
        PlayerData.update(player, d -> d.withCoins(coins - cost));
        stack.setDamageValue(0);
        player.getInventory().setChanged();
        ModNetwork.syncCoins(player);
        msg(player, "§a修好了，花了 " + cost + " 鱼币。", false);
    }

    private static String describeExchange(ShopCatalog.Entry e) {
        String spec = e.exchange();
        int at = spec.indexOf('@');
        String fishPart = at < 0 ? spec : spec.substring(0, at);
        String rest = at < 0 ? "" : spec.substring(at);
        int xi = rest.indexOf('x');
        String count = xi < 0 ? "1" : rest.substring(xi + 1).replace("@each", "");
        if (fishPart.equals("anyRed")) {
            return "任意红品质鱼 ×" + count;
        }
        List<String> names = new ArrayList<>();
        for (String id : fishPart.split("\\+")) {
            names.add(Component.translatable("item.anglertackle." + id).getString());
        }
        return (rest.contains("@RED") ? "红品质 " : "") + String.join(" / ", names)
                + (rest.contains("@each") ? " 各一条" : " ×" + count);
    }

    private static void msg(ServerPlayer player, String s, boolean actionBar) {
        player.displayClientMessage(Component.literal(s).withStyle(ChatFormatting.RESET), actionBar);
    }
}
