package com.whitecobalt.anglertackle.league;

import net.minecraft.core.HolderLookup;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.nbt.ListTag;
import net.minecraft.nbt.Tag;
import net.minecraft.resources.Identifier;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.saveddata.SavedData;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * 联赛的**存档层**（世界级 {@link SavedData}，`docs/37` §3.3）。
 *
 * <h2>为什么是 SavedData（跟着世界走），不是玩家附件</h2>
 * 联赛天然是**世界级**的：一期有一个全局硬截止、一张名次表、一份发奖流水。
 * 放进玩家附件就会变成"每人一份自己的期号" ⇒ 名次与结算没有一个统一时刻 ✗。
 * （排行榜 {@code LeaderboardData} 用同一个理由选了同一条路 ✓。不依赖在线这一条也是它给的：
 * 名次表在**世界**里，玩家离线不影响结算 ✓ —— Hypixel 那种"玩家一走名次就没了"的坑 ✗。）
 *
 * <h2>四个"钉死"的口径都在这里存着（`docs/37` §7）</h2>
 * 一期中途改配置**只影响下一期**：期号、级别、计分口径、硬截止、窗口时长都是**开期时写进来的**。
 * 现读配置的话，同一个人在不同时刻签收会用两套规则 ✗。
 *
 * <h2>回档（`docs/37` §3.2 坑 4）</h2>
 * 时钟只有一个方向：{@code lastSeenGame} 只增不减；读档时若发现当前累计刻**倒退**了，
 * 就把锚点与硬截止**向前钳制**到 {@code lastSeenGame}（"取 max(存档, 当前)"），
 * 免得回档之后同一期被反复触发。发奖另有流水键（{@link #ledger}）——
 * <b>先写键、再发钱</b>，重跑第二次插入失败 ⇒ 天然幂等 ✓。
 */
public class LeagueData extends SavedData {

    /** 数据文件名（存档里 `data/anglertackle_league.dat`）。**不许改名** —— 改名等于所有在跑的联赛消失。 */
    public static final String FILE_ID = "anglertackle_league";

    // ---------------------------------------------------------------- 一期
    /** 期号，0 = 从来没开过（第一 tick 就会开第一期）。 */
    public int seasonId;
    /**
     * **赛季号**（`docs/39` D1）：小中大各办一次 = 一个赛季，**季内三期共用同一个号**。
     *
     * <p>⚠ **独立计数，绝不靠 {@code seasonId} 反推**（`(seasonId-1)/3+1` 那种写法）：
     * 服主一打开 `allowConcurrent`（三级并开），期号与级别的对应关系就散了 ⇒ 反推出来的赛季号会漂 ✗。
     * 计数点只有一处：{@code LeagueService.push} 里"轮到小型那一期"时 +1 ✓。
     */
    public int seasonNo;

    // ---------------------------------------------------------------- 联赛商店限购（**每届刷新**）

    /**
     * 联赛商店的"**本届已买几个**"，键 = {@code S<届号>|<uuid>|<报价 id>}。
     *
     * <h2>为什么放在**世界侧**，而不是玩家附件</h2>
     * 玩家侧那套 `FishermanProgress.stock` 是"**按分钟补货**"的（普通商店用），
     * 混进"按届刷新"会让普通商品也跟着变 ✗。而"每届刷新"本来就是**届**的概念 ⇒ 放这里最贴（`docs/39` §4.2 方案 A）。
     *
     * <h2>届号一变就等价于整表刷新（不需要任何"重置"代码）</h2>
     * 键里带届号 ⇒ 新一届查同一个 (uuid, 报价) 时**永远查不到旧届的计数**（默认 0）✓
     * ⇒ **绝不写"结算时清空商店限购"那种代码**（那才容易漏、也容易误伤别的数据 ✗）。
     */
    public final Map<String, Integer> leagueBought = new HashMap<>();

    /** 本届已买数（不是本届的 ⇒ 0）。 */
    public int leagueBoughtOf(int seasonNoNow, UUID player, String offerId) {
        return this.leagueBought.getOrDefault(leagueStockKey(seasonNoNow, player, offerId), 0);
    }

    /** 记一次购买（顺手把往届残留清掉，免得存档无限长）。 */
    public void leagueAddBought(int seasonNoNow, UUID player, String offerId) {
        String k = leagueStockKey(seasonNoNow, player, offerId);
        this.leagueBought.put(k, this.leagueBought.getOrDefault(k, 0) + 1);
        this.leagueBought.keySet().removeIf((x) -> !x.startsWith("S" + seasonNoNow + "|"));
    }

    private static String leagueStockKey(int seasonNoNow, UUID player, String offerId) {
        return "S" + seasonNoNow + "|" + player + "|" + offerId;
    }
    /** 本期级别（{@link League.Tier#id()}）—— **开期时钉死**。 */
    public String tierId = "";
    /** 本期计分口径（{@code League.Rule} 的配置下标）—— **开期时钉死**。 */
    public int ruleMode;
    /** 本期硬截止（游戏日数）—— **开期时钉死**。 */
    public int periodGameDays;
    /** 本期每人窗口时长（游戏刻）—— **开期时钉死**。 */
    public long windowTicks;
    /** 本期推送时刻与硬截止时刻（累计刻）。 */
    public long openedAtGame;
    public long hardDeadlineGame;
    /** 本期结算过没有（幂等第一道；第二道是 {@link #ledger} 的流水键）。 */
    public boolean settled;

    // ---------------------------------------------------------------- 锚点
    /** 推送锚点（**游戏口径**：累计刻）。 */
    public long pushAnchorGame;
    /** 推送锚点（**现实口径**：UTC 毫秒）。 */
    public long pushAnchorWall;
    /** 见过的最大累计刻（只增不减）—— 回档钳制用。 */
    public long lastSeenGame;
    /** 三级轮转的下一个级别下标（默认不并开，见 `docs/37` §2.1）。 */
    public int nextTierIndex;

    // ---------------------------------------------------------------- 本期参赛者
    /** 本期签收过的人（**世界数据** ⇒ 结算不依赖在线 ✓）。 */
    public final Map<UUID, Member> members = new HashMap<>();
    /** 本期已发过邀请的人（避免重复投递；也用来给"没参赛的人"发公示）。 */
    public final Set<UUID> invited = new LinkedHashSet<>();
    /** 发奖流水键（`season|uuid|tier`）—— **先写键、再发钱**（`docs/37` §5.2）。 */
    public final Set<String> ledger = new HashSet<>();
    /** 离线玩家待投递的东西（邀请 / 成绩单 / 奖励 / 经验 / 称号）—— 登录时兑付。 */
    public final List<Pending> pending = new ArrayList<>();

    // ---------------------------------------------------------------- 上一期公示
    public int lastSeasonId;
    public String lastTierId = "";
    public int lastJoined;
    public int lastRanked;
    /** 名次表文本行 `rank|name|value|catches`（只留最近一期，给 `/atl league` 看）。 */
    public final List<String> lastBoard = new ArrayList<>();

    /**
     * **历届档案**（`docs/39` §6.1，2026-10-13）：每一届结算时把名次表存一份，**全部保留**。
     *
     * <h2>为什么必须有</h2>
     * {@link #lastBoard} 只留**最近一期**（那是给 {@code /atl league} 看的），
     * 而排行榜要能翻"某一赛季（S1…）/ 某一规模"⇒ 老的几届必须活着。
     * 量极小（一届几十行），**全留比"留 N 届再删"简单**，也不会出现"想查的那届正好被删了"。
     *
     * <p>写入是**幂等**的（同届号已有就跳过）—— 结算流程万一重跑，档案里不会出现两条。
     */
    public final List<Season> archive = new ArrayList<>();

    /** 一届的档案：届号 + 规模 + 名次表。 */
    public static final class Season {
        public int seasonNo;
        public String tierId = "";
        public final List<Rank> rows = new ArrayList<>();

        public Season(int seasonNo, String tierId) {
            this.seasonNo = seasonNo;
            this.tierId = tierId == null ? "" : tierId;
        }
    }

    /** 名次表里的一行（字段与结算那一刻的口径一致 —— 不另立一套）。 */
    public static final class Rank {
        public UUID player;
        public String name = "";
        /** 主指标数值（当前赛制下 = 最重一尾 kg）。 */
        public double value;
        /** 窗口内上鱼尾数（"参与度"，与名次表同一个来源）。 */
        public int catches;
    }

    /**
     * 把刚结算的这一届存进档案（**幂等**：同届号已存在就跳过）。
     *
     * <p>只存**上榜的人**（与名次表同一个来源）—— 没上鱼的人不进档案，
     * 否则几十年后档案里全是零分行。
     */
    public void archiveSeason(int seasonNo, String tierId, List<League.Entry> ranked) {
        for (Season s : this.archive) {
            if (s.seasonNo == seasonNo) {
                return;
            }
        }
        Season s = new Season(seasonNo, tierId);
        for (League.Entry e : ranked) {
            Rank r = new Rank();
            r.player = e.player();
            r.name = e.name();
            r.value = e.value();
            r.catches = e.catches();
            s.rows.add(r);
        }
        this.archive.add(s);
        this.setDirty();
    }

    /** 一位参赛者。 */
    public static final class Member {
        public String name = "";
        /** 签收刻（累计刻）。 */
        public long signTick;
        /** 他的窗口终点 = min(签收刻 + 窗口, 硬截止)。 */
        public long windowEnd;
        /** 主指标（口径见本期 {@link #ruleId}）。 */
        public double value;
        /** 这个成绩是何时达成的（并列第二级键）。 */
        public long atTick;
        /** 窗口内上鱼尾数（有效成绩下限用它）。 */
        public int catches;

        public Member(String name, long signTick, long windowEnd) {
            this.name = name;
            this.signTick = signTick;
            this.windowEnd = windowEnd;
            this.atTick = signTick;
        }
    }

    /**
     * 一条**待投递**记录 —— 只对"结算时不在线"的玩家产生。
     *
     * <p>为什么必须有它：邮件与经验都长在**玩家**身上（{@code PlayerData} 是玩家附件），
     * 离线时根本拿不到那个对象。所以结算把"要给谁什么"写进世界数据，等他登录再兑付 ✓
     * —— 这一条同时也保证了"结算不依赖在线"（`docs/37` §8 的断言之一）。
     *
     * <p>{@code template} 为空 ⇒ 不是邮件，只兑付经验/称号。
     */
    public static final class Pending {
        public UUID player;
        public String template = "";
        public List<String> args = new ArrayList<>();
        public long coins;
        public List<ItemStack> items = new ArrayList<>();
        public String action = "";
        /** 垂纶经验（邮件带不了经验 ⇒ 登录时直接入账）。 */
        public int xp;
        /**
         * **联赛积分**（`docs/39` P2：名次分）。
         *
         * <p>为什么走这条队列而不是塞进邮件附件：与 {@link #xp} 完全同一个理由 ——
         * 邮件只能带"鱼币 + 物品"，积分是**第四种载体** ⇒ 离线玩家先记在这里、**登录时补**
         * （`docs/37` §5.2 定的口径："绝不因为玩家没上线就把奖励吞掉"）。
         * 老存档没有这个键 ⇒ {@code getInt} 读出 0 ✓（零迁移）。
         */
        public int points;
        /** 要授予的称号 id（空 = 不授予）。 */
        public String title = "";

        public Pending(UUID player) {
            this.player = player;
        }
    }

    public LeagueData() {
    }

    // ---------------------------------------------------------------- 便捷读写
    public League.Tier tier() {
        return League.Tier.byId(this.tierId);
    }

    public League.Rule rule() {
        return League.Rule.byMode(this.ruleMode);
    }

    public Member member(UUID id) {
        return this.members.get(id);
    }

    /** 记一个人签收（**唯一入口**：签收与结算都只该通过它改 {@link #members}）。 */
    public Member join(UUID id, String name, long signTick, long windowEnd) {
        Member m = new Member(name == null ? "" : name, signTick, windowEnd);
        this.members.put(id, m);
        this.setDirty();
        return m;
    }

    /**
     * 本期名次表（只读）：**只收"上过鱼"的人**（有效成绩下限，`docs/37` §4.3），
     * 按三级并列键排序（{@link League#ORDER}）。
     */
    public List<League.Entry> ranked(int minCatches) {
        List<League.Entry> out = new ArrayList<>();
        for (Map.Entry<UUID, Member> e : this.members.entrySet()) {
            Member m = e.getValue();
            if (m.catches >= Math.max(1, minCatches)) {
                out.add(new League.Entry(e.getKey(), m.name, m.value, m.atTick, m.catches));
            }
        }
        out.sort(League.ORDER);
        return out;
    }

    public void pushPending(Pending p) {
        this.pending.add(p);
        this.setDirty();
    }

    // ---------------------------------------------------------------- 存取
    private static CompoundTag itemToTag(ItemStack s) {
        CompoundTag t = new CompoundTag();
        // ⚠ 只存 id + 数量：联赛奖励全是**没有 NBT 的普通物品**（线 / 拟饵 / 窝料 / 原版物资）。
        //   要带 NBT（附魔、耐久）时得换成 ItemStack.CODEC + registry ops ——
        //   而附件那条持久化路径拿不到 registry（坑记在 MailEntry.CODEC 的注释里）。
        t.putString("id", BuiltInRegistries.ITEM.getKey(s.getItem()).toString());
        t.putInt("n", s.getCount());
        return t;
    }

    private static ItemStack tagToItem(CompoundTag t) {
        Identifier rl = Identifier.tryParse(t.getString("id"));
        if (rl == null) {
            return ItemStack.EMPTY;
        }
        Item item = BuiltInRegistries.ITEM.get(rl);
        return item == null ? ItemStack.EMPTY : new ItemStack(item, Math.max(1, t.getInt("n")));
    }

    private static ListTag itemsToTag(List<ItemStack> items) {
        ListTag list = new ListTag();
        for (ItemStack s : items) {
            if (s != null && !s.isEmpty()) {
                list.add(itemToTag(s));
            }
        }
        return list;
    }

    private static List<ItemStack> tagToItems(ListTag list) {
        List<ItemStack> out = new ArrayList<>();
        for (int i = 0; i < list.size(); i++) {
            ItemStack s = tagToItem(list.getCompound(i));
            if (!s.isEmpty()) {
                out.add(s);
            }
        }
        return out;
    }

    public static LeagueData load(CompoundTag tag, HolderLookup.Provider registries) {
        LeagueData d = new LeagueData();
        d.seasonId = tag.getInt("season");
        d.seasonNo = tag.getInt("season_no");
        ListTag lb = tag.getList("league_bought", Tag.TAG_COMPOUND);
        for (int i = 0; i < lb.size(); i++) {
            CompoundTag t = lb.getCompound(i);
            d.leagueBought.put(t.getString("k"), t.getInt("v"));
        }
        d.tierId = tag.getString("tier");
        d.ruleMode = tag.getInt("rule");
        d.periodGameDays = tag.getInt("period_days");
        d.windowTicks = tag.getLong("window");
        d.openedAtGame = tag.getLong("opened");
        d.hardDeadlineGame = tag.getLong("deadline");
        d.settled = tag.getBoolean("settled");
        d.pushAnchorGame = tag.getLong("anchor_game");
        d.pushAnchorWall = tag.getLong("anchor_wall");
        d.lastSeenGame = tag.getLong("last_seen");
        d.nextTierIndex = tag.getInt("next_tier");
        d.lastSeasonId = tag.getInt("last_season");
        d.lastTierId = tag.getString("last_tier");
        d.lastJoined = tag.getInt("last_joined");
        d.lastRanked = tag.getInt("last_ranked");
        // 历届档案（`docs/39` §6.1）—— 老存档没有这一段，读不到就是空的 ✓
        ListTag arch = tag.getList("archive", Tag.TAG_COMPOUND);
        for (int i = 0; i < arch.size(); i++) {
            CompoundTag sn = arch.getCompound(i);
            Season season = new Season(sn.getInt("season_no"), sn.getString("tier"));
            ListTag rows = sn.getList("rows", Tag.TAG_COMPOUND);
            for (int j = 0; j < rows.size(); j++) {
                CompoundTag e = rows.getCompound(j);
                Rank r = new Rank();
                r.player = e.getUUID("player");
                r.name = e.getString("name");
                r.value = e.getDouble("value");
                r.catches = e.getInt("catches");
                season.rows.add(r);
            }
            if (season.seasonNo > 0) {
                d.archive.add(season);
            }
        }

        ListTag mem = tag.getList("members", Tag.TAG_COMPOUND);
        for (int i = 0; i < mem.size(); i++) {
            CompoundTag t = mem.getCompound(i);
            try {
                UUID id = t.getUUID("uuid");
                Member m = new Member(t.getString("name"), t.getLong("sign"), t.getLong("window_end"));
                m.value = t.getDouble("value");
                m.atTick = t.getLong("at");
                m.catches = t.getInt("catches");
                d.members.put(id, m);
            } catch (Throwable ignored) {
                // 坏行跳过：一元帅的坏数据不该让整个联赛读不出来
            }
        }
        ListTag inv = tag.getList("invited", Tag.TAG_COMPOUND);
        for (int i = 0; i < inv.size(); i++) {
            try {
                d.invited.add(inv.getCompound(i).getUUID("uuid"));
            } catch (Throwable ignored) {
                // 同上
            }
        }
        ListTag led = tag.getList("ledger", Tag.TAG_STRING);
        for (int i = 0; i < led.size(); i++) {
            d.ledger.add(led.getString(i));
        }
        ListTag pend = tag.getList("pending", Tag.TAG_COMPOUND);
        for (int i = 0; i < pend.size(); i++) {
            CompoundTag t = pend.getCompound(i);
            try {
                Pending p = new Pending(t.getUUID("uuid"));
                p.template = t.getString("template");
                ListTag args = t.getList("args", Tag.TAG_STRING);
                for (int k = 0; k < args.size(); k++) {
                    p.args.add(args.getString(k));
                }
                p.coins = t.getLong("coins");
                p.items = tagToItems(t.getList("items", Tag.TAG_COMPOUND));
                p.action = t.getString("action");
                p.xp = t.getInt("xp");
                p.points = t.getInt("points");
                p.title = t.getString("title");
                d.pending.add(p);
            } catch (Throwable ignored) {
                // 同上
            }
        }
        ListTag board = tag.getList("last_board", Tag.TAG_STRING);
        for (int i = 0; i < board.size(); i++) {
            d.lastBoard.add(board.getString(i));
        }
        return d;
    }

    @Override
    public CompoundTag save(CompoundTag tag, HolderLookup.Provider registries) {
        tag.putInt("season", this.seasonId);
        tag.putInt("season_no", this.seasonNo);
        ListTag lb = new ListTag();
        for (Map.Entry<String, Integer> en : this.leagueBought.entrySet()) {
            CompoundTag t = new CompoundTag();
            t.putString("k", en.getKey());
            t.putInt("v", en.getValue());
            lb.add(t);
        }
        tag.put("league_bought", lb);
        tag.putString("tier", this.tierId);
        tag.putInt("rule", this.ruleMode);
        tag.putInt("period_days", this.periodGameDays);
        tag.putLong("window", this.windowTicks);
        tag.putLong("opened", this.openedAtGame);
        tag.putLong("deadline", this.hardDeadlineGame);
        tag.putBoolean("settled", this.settled);
        tag.putLong("anchor_game", this.pushAnchorGame);
        tag.putLong("anchor_wall", this.pushAnchorWall);
        tag.putLong("last_seen", this.lastSeenGame);
        tag.putInt("next_tier", this.nextTierIndex);
        tag.putInt("last_season", this.lastSeasonId);
        tag.putString("last_tier", this.lastTierId);
        tag.putInt("last_joined", this.lastJoined);
        tag.putInt("last_ranked", this.lastRanked);
        // 历届档案（`docs/39` §6.1）—— **全留**，不做保留上限
        ListTag arch = new ListTag();
        for (Season season : this.archive) {
            CompoundTag sn = new CompoundTag();
            sn.putInt("season_no", season.seasonNo);
            sn.putString("tier", season.tierId);
            ListTag rows = new ListTag();
            for (Rank r : season.rows) {
                CompoundTag e = new CompoundTag();
                e.putUUID("player", r.player);
                e.putString("name", r.name);
                e.putDouble("value", r.value);
                e.putInt("catches", r.catches);
                rows.add(e);
            }
            sn.put("rows", rows);
            arch.add(sn);
        }
        tag.put("archive", arch);

        ListTag mem = new ListTag();
        for (Map.Entry<UUID, Member> e : this.members.entrySet()) {
            CompoundTag t = new CompoundTag();
            t.putUUID("uuid", e.getKey());
            t.putString("name", e.getValue().name);
            t.putLong("sign", e.getValue().signTick);
            t.putLong("window_end", e.getValue().windowEnd);
            t.putDouble("value", e.getValue().value);
            t.putLong("at", e.getValue().atTick);
            t.putInt("catches", e.getValue().catches);
            mem.add(t);
        }
        tag.put("members", mem);

        ListTag inv = new ListTag();
        for (UUID id : this.invited) {
            CompoundTag t = new CompoundTag();
            t.putUUID("uuid", id);
            inv.add(t);
        }
        tag.put("invited", inv);

        ListTag led = new ListTag();
        for (String k : this.ledger) {
            led.add(net.minecraft.nbt.StringTag.valueOf(k));
        }
        tag.put("ledger", led);

        ListTag pend = new ListTag();
        for (Pending p : this.pending) {
            CompoundTag t = new CompoundTag();
            t.putUUID("uuid", p.player);
            t.putString("template", p.template);
            ListTag args = new ListTag();
            for (String a : p.args) {
                args.add(net.minecraft.nbt.StringTag.valueOf(a));
            }
            t.put("args", args);
            t.putLong("coins", p.coins);
            t.put("items", itemsToTag(p.items));
            t.putString("action", p.action);
            t.putInt("xp", p.xp);
            t.putInt("points", p.points);
            t.putString("title", p.title);
            pend.add(t);
        }
        tag.put("pending", pend);

        ListTag board = new ListTag();
        for (String row : this.lastBoard) {
            board.add(net.minecraft.nbt.StringTag.valueOf(row));
        }
        tag.put("last_board", board);
        return tag;
    }

    /** 取（或建）这份存档。传 {@code ServerLevel} 是有意的：联赛跟着**那个世界**走 ✓。 */
    public static LeagueData get(ServerLevel level) {
        return level.getDataStorage().computeIfAbsent(
                new SavedData.Factory<>(LeagueData::new, LeagueData::load),
                FILE_ID);
    }

    /** 备用入口：只有 {@code MinecraftServer} 时取主世界那份（指令 / 每 tick 检查用）。 */
    public static LeagueData get(MinecraftServer server) {
        return get(server.overworld());
    }
}
