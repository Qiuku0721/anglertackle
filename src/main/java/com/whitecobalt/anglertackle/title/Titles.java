package com.whitecobalt.anglertackle.title;

import com.whitecobalt.anglertackle.AnglersTackle;
import com.whitecobalt.anglertackle.fishing.FishSpecies;
import com.whitecobalt.anglertackle.leaderboard.Leaderboard;
import com.whitecobalt.anglertackle.leaderboard.LeaderboardData;
import com.whitecobalt.anglertackle.player.AnglerLeveling;
import com.whitecobalt.anglertackle.player.CodexEntry;
import com.whitecobalt.anglertackle.player.FishermanData;
import com.whitecobalt.anglertackle.player.PlayerData;
import com.whitecobalt.anglertackle.player.PlayerFishingData;
import com.whitecobalt.anglertackle.player.PlayerTitles;
import com.whitecobalt.anglertackle.registry.ModAttachments;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerPlayer;

import java.util.List;
import java.util.Map;

/**
 * 称号系统（用户 2026-10-11："开发称号系统" / "备选加过渡加。然后推进。"）。
 *
 * <h2>三个入口，别再多</h2>
 * <ol>
 *   <li>{@link #grant(ServerPlayer, String)} —— **唯一授予入口**：幂等、写日志、
 *       在聊天里报一句。任何地方（自动条件、服主指令、将来的联赛结算）都走它；</li>
 *   <li>{@link #bump(ServerPlayer, String, int)} / {@link #setBit(ServerPlayer, String, int)}
 *       —— 记"**算不出来的进度**"（红档尾数、夜晚尾数、菜型位掩码…）；</li>
 *   <li>{@link #syncAuto(ServerPlayer)} —— **唯一的条件评估入口**：把"能从现有数据算出来"
 *       的那批条件当场判一遍（图鉴 / 等级 / 巨物 / 纪录级 / 三冠 / 红档 / 传说三连 /
 *       鳄雀鳝 / 各类计数阈值）。上鱼之后、设等级之后、破纪录之后各调一次就够。</li>
 * </ol>
 *
 * <h2>为什么"评估"要收成一处</h2>
 * 如果把判定散在 {@code onCatch} / 指令 / 排行榜回调里，同一条称号迟早会在两处
 * 用两种写法判（"图鉴说 47 种、称号说 48 种"就是这么来的）。收成一处之后，
 * 加一条新称号 = 改 {@link TitleDefs} 表 + 在这里加一行判断 ✓。
 *
 * <h2>数字全部来自配置或源码，没有一个是写在这里的</h2>
 * 阈值走 {@code [titles]} 配置组（{@code Tuning} 的 getter）；
 * 等级线走 {@link AnglerLeveling} 的常量；"能出金的鱼种数"**从 {@link FishSpecies} 数**
 * （47 种里有 17 种的档位上限只到紫，天生够不到金 ⇒ "47 种全金"是永远拿不到的条件 ✗）。
 */
public final class Titles {

    // ---------------------------------------------------------------- 进度键
    /** 累计钓到的红档尾数（`red_first` 之外的那些要看它）。 */
    public static final String K_RED = "red_caught";
    /** 夜晚时段累计上鱼尾数。 */
    public static final String K_NIGHT = "night";
    /** 满月夜累计上鱼尾数。 */
    public static final String K_FULL_MOON = "full_moon";
    /** 冰洞里累计上鱼尾数。 */
    public static final String K_ICE = "ice";
    /** 雷暴天钓到过金档以上（0/1）。 */
    public static final String K_STORM_GOLD = "storm_gold";
    /** 累计打窝次数。 */
    public static final String K_CHUM = "chum";
    /** 累计断线次数。 */
    public static final String K_LINE_BREAK = "line_break";
    /** 做过的菜型位掩码（`DishRecipe.Dish` 的 ordinal）。 */
    public static final String K_DISH_MADE = "dishes_made";
    /** 吃过的菜型位掩码。 */
    public static final String K_DISH_EATEN = "dishes_eaten";
    /** 吃过的食用适宜度等级位掩码（L0~L4）。 */
    public static final String K_PALAT = "palat_seen";
    /** 累计签收的联赛期数。 */
    public static final String K_LEAGUE_JOINED = "league_joined";
    /**
     * 累计**成功上鱼**次数（成就 `e_land_50` 用）。
     *
     * <p>⚠ 计数点选在 {@code LeaderboardHooks.onLanded} —— 那是"这条鱼真的上岸了"的**唯一出口**，
     * 所以既不会漏、也不会一条鱼记两次（与 `K_LINE_BREAK` 放在断线唯一出口是同一条纪律）。
     */
    public static final String K_LAND = "landed";

    /** 传说三连要的那三条鱼（用户 2026-10-11 定的）。 */
    private static final List<String> LEGENDARY = List.of(
            "giant_siamese_carp", "greenland_shark", "electric_eel");
    /** 鳄雀鳝（入侵种）。 */
    private static final String GAR = "alligator_gar";

    private Titles() {
    }

    // ---------------------------------------------------------------- 读
    public static PlayerTitles get(ServerPlayer player) {
        return com.whitecobalt.anglertackle.player.PlayerData.getTitles(player);
    }

    private static PlayerTitles set(ServerPlayer player, PlayerTitles next) {
        // ⚠ 必须走 PlayerData 这个入口类（**唯一**允许 setData 的地方）——
        //   直接 player.setData(...) 时"改了对象忘写回"会静默失效，而症状只是
        //   "称号拿到了但一重启就没了"（tools/check-player-data.js 守着这条）。
        com.whitecobalt.anglertackle.player.PlayerData.setTitles(player, next);
        return next;
    }

    /** 某个进度的当前值。 */
    public static int progress(ServerPlayer player, String key) {
        return get(player).progressOf(key);
    }

    // ---------------------------------------------------------------- 佩戴
    /**
     * 佩戴的结果码。
     *
     * <p>为什么要有它（而不是"返回 true/false"）：界面要**分得清**"你没拿到这个称号"
     * 和"这个 id 根本不存在" —— 后者只可能是客户端在乱造 id（服务端一律拒绝），
     * 把两者混成一句"不能佩戴"会让真出问题时查不下去。
     */
    public enum EquipResult {
        /** 戴上了 / 本来就是它 / 已经摘掉了 —— 都是"现在的状态就是你要的"。 */
        OK,
        /** 表里没有这个 id（客户端伪造）。 */
        UNKNOWN,
        /** 表里有，但这个玩家没拿到。 */
        NOT_OWNED
    }

    /**
     * 佩戴某个称号（空串 / {@code none} = 摘掉）—— **只改发起者自己**，幂等。
     *
     * <p>⚠ 与 {@code /atl title use} 走**同一个方法**：指令和界面是两条入口，
     * 判定必须只有一份（各写一遍迟早分叉：一边允许用没拿到的称号，另一边不允许）。
     */
    public static EquipResult equip(ServerPlayer player, String id) {
        if (player == null) {
            return EquipResult.UNKNOWN;
        }
        if (id == null || id.isEmpty() || "none".equalsIgnoreCase(id)) {
            return unequip(player);
        }
        if (TitleDefs.byId(id) == null && !TitleDefs.validInstance(id)) {
            return EquipResult.UNKNOWN;
        }
        if (!get(player).has(id)) {
            return EquipResult.NOT_OWNED;
        }
        if (id.equals(get(player).equipped())) {
            return EquipResult.OK;      // 幂等：已经戴着就不写回（少一次附件同步）
        }
        com.whitecobalt.anglertackle.player.PlayerData.updateTitles(player, x -> x.withEquipped(id));
        // 名牌那张表要跟着变（`docs/38` §2.1）—— 这里是**唯一**改佩戴的入口，
        // 所以同步挂在这里就天然全覆盖（指令与界面两条入口都走它 ✓）。
        com.whitecobalt.anglertackle.network.ModNetwork.broadcastNameplates(player.server);
        return EquipResult.OK;
    }

    /** 摘掉（没戴也算成功 —— 幂等）。 */
    public static EquipResult unequip(ServerPlayer player) {
        if (player == null) {
            return EquipResult.UNKNOWN;
        }
        com.whitecobalt.anglertackle.player.PlayerData.updateTitles(player, x -> x.withEquipped(""));
        // 同上：摘掉也要让**别人的**名牌立刻恢复成"只有名字"
        com.whitecobalt.anglertackle.network.ModNetwork.broadcastNameplates(player.server);
        return EquipResult.OK;
    }

    /**
     * 本服**在线**拿到这个称号的玩家名（按加入顺序）。
     *
     * <p>只数在线 —— 所以界面上的措辞是"在线 N 人拥有"，不能写成"全服 N 人"
     * （离线玩家的附件不在内存里，硬要去读就是拿存档文件当数据库 ✗）。
     * 与 {@code /atl title list <玩家>} 同一条口径："别人也看得到" ✓，不加权限 ✓。
     */
    public static List<String> holders(ServerPlayer viewer, String id) {
        List<String> out = new java.util.ArrayList<>();
        if (viewer == null || viewer.server == null || id == null) {
            return out;
        }
        for (ServerPlayer p : viewer.server.getPlayerList().getPlayers()) {
            if (get(p).has(id)) {
                out.add(p.getName().getString());
            }
        }
        return out;
    }

    // ---------------------------------------------------------------- 写
    /**
     * **唯一授予入口**（幂等）。
     *
     * <p>已经有 ⇒ **可重复**称号只 +1 次（显示 `×N`）；**不可重复**称号直接返回、
     * **连计数都不动**（`docs/41` §9.6 第 3 条闸）。两者都**不重复报**、也不重复发任何东西；
     * 第一次拿到 ⇒ 报一句 + 写一条服务端日志（方便对账"这个称号是怎么来的"）。
     *
     * <p>⚠ 邮件（`docs/36`）落地后，"授予时自动发一封邮件"接在这个方法里 ——
     * 现在**故意不接假实现**（触发源还没到位就不许先写一个空壳 ✗）。
     */
    public static boolean grant(ServerPlayer player, String id) {
        if (player == null) {
            return false;
        }
        // 静态表查得到 ⇒ 走老路（40 条一行不改）；
        // 查不到再问"是不是生成式实例"（模板在表里 + 参数合法）—— 只有这一处放行 ✓
        TitleDefs.Def def = TitleDefs.byId(id);
        if (def == null && !TitleDefs.validInstance(id)) {
            return false;
        }
        PlayerTitles cur = get(player);
        // `docs/41` §9.6 第 3 条闸：**不可重复**的称号已拥有 ⇒ 直接返回，不动数据、也不 +1。
        // 为什么值得单独一道闸：`counts` 只对**可重复**称号有意义（那才是 `×N` 显示的依据），
        // 不可重复的称号被重复 grant 只会留下一个"无意义 +1"；等成就这类新调用方变多，脏计数会累积。
        // 生成式实例（def == null，如 `S1大型联赛冠军`）本就按可重复处理 ⇒ 只挡 def != null && !repeatable()。
        if (def != null && !def.repeatable() && cur.has(id)) {
            return false;
        }
        boolean first = !cur.has(id);
        PlayerTitles next = cur.withGrant(id);
        set(player, next);
        if (first) {
            player.displayClientMessage(Component.translatable("message.anglertackle.title_got",
                    Component.translatable(nameKey(id), nameArgs(id)).withStyle(com.whitecobalt.anglertackle.item
                            .Quality.of(TitleDefs.qualityOf(id)).color())), false);
            AnglersTackle.LOGGER.info("[垂纶] 称号授予：{} 拿到 {}（{}）",
                    player.getName().getString(), id,
                    Component.translatable(nameKey(id), nameArgs(id)).getString());
        }
        return first;
    }

    /** 计数值 +delta（进度键见本类的 K_* 常量）。 */
    public static void bump(ServerPlayer player, String key, int delta) {
        if (player == null || key == null || delta == 0) {
            return;
        }
        PlayerTitles cur = get(player);
        set(player, cur.withProgress(key, Math.max(0, cur.progressOf(key) + delta)));
    }

    /** 把位掩码的第 bit 位置 1（菜型 / 适口等级）。 */
    public static void setBit(ServerPlayer player, String key, int bit) {
        if (player == null || key == null || bit < 0 || bit > 30) {
            return;
        }
        PlayerTitles cur = get(player);
        int mask = cur.progressOf(key) | (1 << bit);
        if (mask != cur.progressOf(key)) {
            set(player, cur.withProgress(key, mask));
        }
    }

    // ---------------------------------------------------------------- 评估
    /**
     * 把"能从现有数据算出来"的条件全部判一遍 —— **幂等**，随时可重复调用。
     *
     * <p>调用点：上鱼（图鉴/经验记完之后）、`/atl stage` 之后、破纪录之后。
     */
    public static void syncAuto(ServerPlayer player) {
        if (player == null) {
            return;
        }
        try {
            syncCodex(player);
            syncLevel(player);
            syncAnglersRecord(player);
            syncCounters(player);
        } catch (Throwable t) {
            // 称号只是"锦上添花"：绝不能因为它把上鱼结算带崩（丢鱼才是最贵的）
            AnglersTackle.LOGGER.warn("[垂纶] 称号评估失败（已忽略）：{}", t.toString());
        }
    }

    /** 图鉴线 + 巨物线 + 纪录/稀有（全部从图鉴那份数据算）。 */
    private static void syncCodex(ServerPlayer player) {
        PlayerFishingData d = PlayerData.get(player);
        Map<String, CodexEntry> codex = d.codex();
        int species = d.codexCount();

        if (species >= 1) {
            grant(player, "first_catch");
        }
        if (species >= com.whitecobalt.anglertackle.fishing.Tuning.titleCodexCount5()) {
            grant(player, "codex_5");
        }
        if (species >= com.whitecobalt.anglertackle.fishing.Tuning.titleCodexCount10()) {
            grant(player, "codex_10");
        }
        if (species >= com.whitecobalt.anglertackle.fishing.Tuning.titleCodexCount24()) {
            grant(player, "codex_24");
        }
        if (species >= com.whitecobalt.anglertackle.fishing.Tuning.titleCodexCount40()) {
            grant(player, "codex_40");
        }
        if (species >= FishSpecies.ALL.size()) {
            grant(player, "codex_all");
        }

        // 能出金的鱼种（从 FishSpecies 数，绝不写死）—— 见类注释
        int goldCapable = 0;
        int goldDone = 0;
        float heaviest = 0f;
        boolean anyRed = false;
        boolean anyRecord = false;
        for (Map.Entry<String, CodexEntry> e : codex.entrySet()) {
            CodexEntry v = e.getValue();
            heaviest = Math.max(heaviest, v.maxKg());
            if (v.bestTier() >= 5) {
                anyRed = true;
            }
            if (v.seenGrade(com.whitecobalt.anglertackle.fishing.FishData.SizeGrade.RECORD.ordinal())) {
                anyRecord = true;
            }
            FishSpecies sp = FishSpecies.byId(e.getKey());
            if (sp != null && sp.maxTier() >= 4) {
                goldCapable++;
                if (v.bestTier() >= 4) {
                    goldDone++;
                }
            }
        }
        if (goldDone >= com.whitecobalt.anglertackle.fishing.Tuning.titleGoldCount10()) {
            grant(player, "codex_gold_10");
        }
        if (goldCapable > 0 && goldDone >= goldCapable) {
            grant(player, "codex_gold_all");
        }

        if (heaviest >= com.whitecobalt.anglertackle.fishing.Tuning.titleGiantKg5()) {
            grant(player, "giant_5");
        }
        if (heaviest >= com.whitecobalt.anglertackle.fishing.Tuning.titleGiantKg20()) {
            grant(player, "giant_20");
        }
        if (heaviest >= com.whitecobalt.anglertackle.fishing.Tuning.titleGiantKg50()) {
            grant(player, "giant_50");
        }
        if (heaviest >= com.whitecobalt.anglertackle.fishing.Tuning.titleGiantKg100()) {
            grant(player, "giant_100");
        }

        if (anyRecord) {
            grant(player, "record_grade");
        }
        if (anyRed) {
            grant(player, "red_first");
        }
        if (containsAll(codex, LEGENDARY)) {
            grant(player, "legendary_three");
        }
        CodexEntry gar = codex.get(GAR);
        if (gar != null && gar.count() >= com.whitecobalt.anglertackle.fishing.Tuning.titleGarCount()) {
            grant(player, "gar_hunter");
        }
    }

    /** 等级线（阈值来自 {@link AnglerLeveling} 的常量，不是配置 —— 它们本来就是游戏的结构）。 */
    private static void syncLevel(ServerPlayer player) {
        int lv = FishermanData.get(player).level();
        int[] gates = AnglerLeveling.GATE_LEVELS;   // 10 / 20 / 30 / 40（评定点）
        if (lv >= gates[0]) {
            grant(player, "angler_10");
        }
        if (lv > gates[1]) {
            // "高于 20" = 过了评定②（用户对联赛资格的原话就是"钓鱼等级高于 20"）
            grant(player, "angler_21");
        }
        if (lv > gates[2]) {
            grant(player, "angler_31");
        }
        if (lv > gates[3]) {
            grant(player, "angler_40");
        }
        if (lv >= AnglerLeveling.MAX_LEVEL) {
            grant(player, "angler_50");
        }
    }

    /** 三冠王：本服三项榜**各拿过一次第一**（不要求同时 —— 那做不到，见 docs/38 §4.1）。 */
    private static void syncAnglersRecord(ServerPlayer player) {
        LeaderboardData data = LeaderboardData.get(player.serverLevel());
        boolean all = true;
        for (Leaderboard.Board b : List.of(Leaderboard.Board.HEAVIEST,
                Leaderboard.Board.LONGEST_FIGHT, Leaderboard.Board.FASTEST_CATCH)) {
            List<LeaderboardData.Record> top = data.top(b, 1);
            if (top.isEmpty() || !player.getUUID().equals(top.get(0).player)) {
                all = false;
                break;
            }
        }
        if (all) {
            grant(player, "big_three");
        }
    }

    /** 计数类阈值（红档尾数 / 夜晚 / 满月 / 冰洞 / 雷暴 / 打窝 / 断线 / 菜型 / 适口）。 */
    private static void syncCounters(ServerPlayer player) {
        PlayerTitles cur = get(player);
        if (cur.progressOf(K_RED) >= com.whitecobalt.anglertackle.fishing.Tuning.titleRedCount()) {
            grant(player, "red_collector");
        }
        if (cur.progressOf(K_NIGHT) >= com.whitecobalt.anglertackle.fishing.Tuning.titleNightCount()) {
            grant(player, "night_owl");
        }
        if (cur.progressOf(K_FULL_MOON) >= com.whitecobalt.anglertackle.fishing.Tuning.titleFullMoonCount()) {
            grant(player, "moon_chaser");
        }
        if (cur.progressOf(K_ICE) >= com.whitecobalt.anglertackle.fishing.Tuning.titleIceCount()) {
            grant(player, "ice_angler");
        }
        if (cur.progressOf(K_STORM_GOLD) >= 1) {
            grant(player, "storm_rider");
        }
        if (cur.progressOf(K_CHUM) >= com.whitecobalt.anglertackle.fishing.Tuning.titleChumCount()) {
            grant(player, "chum_master");
        }
        if (cur.progressOf(K_LINE_BREAK) >= com.whitecobalt.anglertackle.fishing.Tuning.titleLineBreakCount()) {
            grant(player, "line_breaker");
        }
        int made = Integer.bitCount(cur.progressOf(K_DISH_MADE));
        int dishes = com.whitecobalt.anglertackle.recipe.DishRecipe.Dish.values().length;
        if (made >= Math.min(dishes, com.whitecobalt.anglertackle.fishing.Tuning.titleDishMadeCount())) {
            grant(player, "chef_10");
        }
        if (Integer.bitCount(cur.progressOf(K_DISH_EATEN))
                >= com.whitecobalt.anglertackle.fishing.Tuning.titleDishEatenCount()) {
            grant(player, "gourmet");
        }
        // 百无禁忌：L0~L4 各吃过一次（L5 = 非食物、根本不进菜品菜单 ⇒ 条件只到 L4）
        int need = 0b11111;
        if ((cur.progressOf(K_PALAT) & need) == need) {
            grant(player, "iron_stomach");
        }
    }

    private static boolean containsAll(Map<String, CodexEntry> codex, List<String> ids) {
        for (String id : ids) {
            if (!codex.containsKey(id)) {
                return false;
            }
        }
        return true;
    }

    // ---------------------------------------------------------------- 文案键
    /**
     * 称号名的语言键。
     *
     * <p>⚠ **实例 id（`docs/39` §5）在这里被拆成模板**：`league_champ@S1-large` ⇒
     * `title.anglertackle.league_champ` —— 于是"名字只有模板一份"，往后的赛季不用加任何文案 ✓。
     * 静态 id 原样返回（40 条一个字都不变）✓
     */
    public static String nameKey(String id) {
        return "title.anglertackle." + TitleDefs.templateIdOf(id);
    }

    /** 获得条件的语言键（邮件与 `/atl title list` 都用它 —— 只有这一份）。 */
    public static String condKey(String id) {
        return "title.anglertackle." + TitleDefs.templateIdOf(id) + ".cond";
    }

    /**
     * 名字里的**参数**：静态称号没有参数（空数组，语言文件里也没有 %s）；
     * 实例是 {@code {赛季号, 规模名}}，规模名直接**复用联赛的语言键**
     * （`league.anglertackle.tier.large` = "大型" ⇒ 拼出"S1大型联赛冠军"）✓
     */
    public static Object[] nameArgs(String id) {
        if (!TitleDefs.isInstance(id)) {
            return new Object[0];
        }
        int si = Math.max(0, TitleDefs.sizeIndex(id));
        String size = si < TitleDefs.SIZES.size() ? TitleDefs.SIZES.get(si) : TitleDefs.SIZES.get(0);
        return new Object[] {String.valueOf(TitleDefs.seasonOf(id)),
                Component.translatable("league.anglertackle.tier." + size)};
    }

    /** 品质（静态走 ALL、实例走模板 × 规模）—— 界面/聊天取色一律走它。 */
    public static int qualityOf(String id) {
        return TitleDefs.qualityOf(id);
    }
}
