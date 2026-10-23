package com.whitecobalt.anglertackle.contest;

import com.whitecobalt.anglertackle.util.NbtCompat;
import net.minecraft.core.Holder;
import net.minecraft.core.HolderLookup;
import net.minecraft.core.UUIDUtil;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.nbt.ListTag;
import net.minecraft.nbt.Tag;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.level.saveddata.SavedData;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * 比赛的**存档层**（世界级 {@link SavedData}，`docs/35` §3）。
 *
 * <h2>为什么是世界级 SavedData</h2>
 * 一场比赛是**全服**的一件事（一个开始时刻、一个结束时刻、一张成绩表）⇒ 跟着存档走 ✓：
 * 服务器重启后**比赛继续跑剩余时间**（存的是**绝对的结束时刻**，不是"剩余秒数"——
 * 后者重启一次就不准了，`docs/35` §9 的断言之一）。
 *
 * <h2>离线奖励（与联赛同一套做法）</h2>
 * 结算那一刻不在线的获奖者，钱记进 {@link #pendingCoins}，**登录时兑付** ——
 * 绝不因为"他下线了"把奖励吞掉 ✓（鱼币与称号都长在**玩家**身上，离线时拿不到那个对象）。
 */
public class ContestData extends SavedData {

    /** 数据文件名（存档里 `data/anglertackle_contest.dat`）。**不许改名**。 */
    public static final String FILE_ID = "anglertackle_contest";

    // ---------------------------------------------------------------- 正在进行的这一场
    /** 有没有正在进行的比赛。 */
    public boolean running;
    /** 赛制下标（{@link Contest.Rule}）—— **开赛时钉死**，中途改配置不影响这一场 ✓。 */
    public int ruleMode;
    /** 开赛时刻与**绝对**结束时刻（都是**累计刻**：服务器停机期间不走表，与联赛同一口径）。 */
    public long startGame;
    public long endGame;
    /** 这一场定下的时长（分钟）—— 只用于显示与存档可读性。 */
    public int minutes;
    /** 结算过没有（幂等：重复结算不会重复发钱）。 */
    public boolean settled;
    /** 本场成绩表（UUID → 当前最好的一条）。**只用内存不落盘的话重启就丢** ⇒ 一起存 ✓。 */
    public final Map<UUID, Contest.Entry> scores = new LinkedHashMap<>();

    // ---------------------------------------------------------------- 上一场（/atl contest last）
    public int lastRuleMode;
    public long lastStart;
    public long lastEnd;
    public int lastPlayers;
    /** 名次文本行 `rank|name|value|fishId|kg|catches`（只留最近一场）。 */
    public final List<String> lastBoard = new ArrayList<>();

    // ---------------------------------------------------------------- 离线待领
    /** 结算时不在线的获奖者：鱼币。 */
    public final Map<UUID, Long> pendingCoins = new HashMap<>();
    /** 结算时不在线的冠军：称号 id（可重复 ⇒ 显示 ×N）。 */
    public final Map<UUID, String> pendingTitles = new HashMap<>();
    /** 最后一次自动开赛的时刻（累计刻）—— `autoEveryMinutes` 用它算间隔。 */
    public long lastAutoStartGame;

    public ContestData() {
    }

    /** 当前赛制（按下标取，开赛时钉死的那个）。 */
    public Contest.Rule rule() {
        return Contest.Rule.byMode(this.ruleMode);
    }

    /**
     * 名次表（只读）：按三级并列键排序。
     *
     * <p>⚠ 成绩表里每一条都**至少上过一尾**（没上鱼的人根本不会进表）⇒ 这里不需要再过滤 ——
     * 但"0 人上鱼"是合法情况（`docs/35` §6 第 1 条：那时公告"本场无人上鱼"，不是静默 ✗）。
     */
    public List<Contest.Entry> ranked() {
        List<Contest.Entry> out = new ArrayList<>(this.scores.values());
        out.sort(Contest.ORDER);
        return out;
    }

    /** 把一次上鱼并进成绩表（**唯一写入口**，只在上鱼那一帧调一次）。 */
    public void submit(Contest.Entry e) {
        Contest.Entry cur = this.scores.get(e.player());
        if (cur == null) {
            this.scores.put(e.player(), e);
            this.setDirty();
            return;
        }
        Contest.Rule rule = this.rule();
        if (rule.cumulative()) {
            this.scores.put(e.player(), new Contest.Entry(e.player(), e.name(),
                    cur.value() + e.value(), e.atTick(), cur.catches() + 1,
                    better(cur, e).fishId(), better(cur, e).weightKg(),
                    better(cur, e).lengthCm(), better(cur, e).grade(),
                    Math.max(cur.tier(), e.tier())));
        } else if (e.value() > cur.value() || (e.value() == cur.value() && e.atTick() < cur.atTick())) {
            // 单场型：只在**更重**（或同重但更早，理论上不会发生）时替换
            this.scores.put(e.player(), new Contest.Entry(e.player(), e.name(), e.value(), e.atTick(),
                    1, e.fishId(), e.weightKg(), e.lengthCm(), e.grade(), e.tier()));
        } else {
            // 没超过：只把尾数 +1（"这条不如我现在那条"也是真钓上来的）
            this.scores.put(e.player(), new Contest.Entry(e.player(), e.name(), cur.value(), cur.atTick(),
                    cur.catches() + 1, cur.fishId(), cur.weightKg(), cur.lengthCm(),
                    cur.grade(), Math.max(cur.tier(), e.tier())));
        }
        this.setDirty();
    }

    /** 两次上鱼里"更重的那一条"（累计型也要记下最大的一尾，用于显示）。 */
    private static Contest.Entry better(Contest.Entry a, Contest.Entry b) {
        return b.weightKg() > a.weightKg() ? b : a;
    }

    // ---------------------------------------------------------------- 存取
    private static CompoundTag entryTag(Contest.Entry e) {
        CompoundTag t = new CompoundTag();
        t.putIntArray("uuid", UUIDUtil.uuidToIntArray(e.player()));
        t.putString("name", e.name() == null ? "" : e.name());
        t.putDouble("value", e.value());
        t.putLong("at", e.atTick());
        t.putInt("catches", e.catches());
        t.putString("fish", e.fishId() == null ? "" : e.fishId());
        t.putDouble("kg", e.weightKg());
        t.putDouble("len", e.lengthCm());
        t.putString("grade", e.grade() == null ? "" : e.grade());
        t.putInt("tier", e.tier());
        return t;
    }

    private static Contest.Entry entryFrom(CompoundTag t) {
        return new Contest.Entry(t.getIntArray("uuid").map(UUIDUtil::uuidFromIntArray).orElseThrow(),
                t.getStringOr("name", ""), t.getDoubleOr("value", 0.0),
                t.getLongOr("at", 0L), t.getIntOr("catches", 0), t.getStringOr("fish", ""),
                t.getDoubleOr("kg", 0.0), t.getDoubleOr("len", 0.0), t.getStringOr("grade", ""),
                t.getIntOr("tier", 0));
    }

    public static ContestData load(CompoundTag tag, HolderLookup.Provider registries) {
        ContestData d = new ContestData();
        d.running = tag.getBooleanOr("running", false);
        d.ruleMode = tag.getIntOr("rule", 0);
        d.startGame = tag.getLongOr("start", 0L);
        d.endGame = tag.getLongOr("end", 0L);
        d.minutes = tag.getIntOr("minutes", 0);
        d.settled = tag.getBooleanOr("settled", false);
        d.lastRuleMode = tag.getIntOr("last_rule", 0);
        d.lastStart = tag.getLongOr("last_start", 0L);
        d.lastEnd = tag.getLongOr("last_end", 0L);
        d.lastPlayers = tag.getIntOr("last_players", 0);
        d.lastAutoStartGame = tag.getLongOr("last_auto", 0L);
        ListTag sc = NbtCompat.listOf(tag, "scores", Tag.TAG_COMPOUND);
        for (int i = 0; i < sc.size(); i++) {
            try {
                Contest.Entry e = entryFrom(sc.getCompoundOrEmpty(i));
                d.scores.put(e.player(), e);
            } catch (Throwable ignored) {
                // 坏行跳过：一份坏数据不该让整场读不出来
            }
        }
        ListTag lb = NbtCompat.listOf(tag, "last_board", Tag.TAG_STRING);
        for (int i = 0; i < lb.size(); i++) {
            d.lastBoard.add(lb.getStringOr(i, ""));
        }
        ListTag pc = NbtCompat.listOf(tag, "pending_coins", Tag.TAG_COMPOUND);
        for (int i = 0; i < pc.size(); i++) {
            CompoundTag t = pc.getCompoundOrEmpty(i);
            try {
                d.pendingCoins.put(t.getIntArray("uuid").map(UUIDUtil::uuidFromIntArray).orElseThrow(),
                        t.getLongOr("coins", 0L));
            } catch (Throwable ignored) {
                // 同上
            }
        }
        ListTag pt = NbtCompat.listOf(tag, "pending_titles", Tag.TAG_COMPOUND);
        for (int i = 0; i < pt.size(); i++) {
            CompoundTag t = pt.getCompoundOrEmpty(i);
            try {
                d.pendingTitles.put(t.getIntArray("uuid").map(UUIDUtil::uuidFromIntArray).orElseThrow(),
                        t.getStringOr("title", ""));
            } catch (Throwable ignored) {
                // 同上
            }
        }
        return d;
    }

    @Override
    public CompoundTag save(CompoundTag tag, HolderLookup.Provider registries) {
        tag.putBoolean("running", this.running);
        tag.putInt("rule", this.ruleMode);
        tag.putLong("start", this.startGame);
        tag.putLong("end", this.endGame);
        tag.putInt("minutes", this.minutes);
        tag.putBoolean("settled", this.settled);
        tag.putInt("last_rule", this.lastRuleMode);
        tag.putLong("last_start", this.lastStart);
        tag.putLong("last_end", this.lastEnd);
        tag.putInt("last_players", this.lastPlayers);
        tag.putLong("last_auto", this.lastAutoStartGame);
        ListTag sc = new ListTag();
        for (Contest.Entry e : this.scores.values()) {
            sc.add(entryTag(e));
        }
        tag.put("scores", sc);
        ListTag lb = new ListTag();
        for (String row : this.lastBoard) {
            lb.add(net.minecraft.nbt.StringTag.valueOf(row));
        }
        tag.put("last_board", lb);
        ListTag pc = new ListTag();
        for (Map.Entry<UUID, Long> e : this.pendingCoins.entrySet()) {
            CompoundTag t = new CompoundTag();
            t.putIntArray("uuid", UUIDUtil.uuidToIntArray(e.getKey()));
            t.putLong("coins", e.getValue());
            pc.add(t);
        }
        tag.put("pending_coins", pc);
        ListTag pt = new ListTag();
        for (Map.Entry<UUID, String> e : this.pendingTitles.entrySet()) {
            CompoundTag t = new CompoundTag();
            t.putIntArray("uuid", UUIDUtil.uuidToIntArray(e.getKey()));
            t.putString("title", e.getValue());
            pt.add(t);
        }
        tag.put("pending_titles", pt);
        return tag;
    }

    public static ContestData get(ServerLevel level) {
        return level.getDataStorage().computeIfAbsent(
                new SavedData.Factory<>(ContestData::new, ContestData::load),
                FILE_ID);
    }

    public static ContestData get(MinecraftServer server) {
        return get(server.overworld());
    }

    /** 给界面用的只读名次（前 N 名，`rank|name|value|fish|kg|catches` 之外的结构化版本）。 */
    public List<Contest.Entry> top(int limit) {
        List<Contest.Entry> all = this.ranked();
        return all.subList(0, Math.min(Math.max(0, limit), all.size()));
    }

    /** 供排序稳定性自检用（与 {@link Contest#ORDER} 同一个比较器，别处不许再定义一份）。 */
    public static Comparator<Contest.Entry> order() {
        return Contest.ORDER;
    }
}
