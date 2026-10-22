package com.whitecobalt.anglertackle.player;

import com.mojang.serialization.Codec;
import com.mojang.serialization.codecs.RecordCodecBuilder;

import java.util.HashMap;
import java.util.Map;

/**
 * 玩家长线数据：**鱼币 + 图鉴 + 已领里程碑**。
 *
 * <h2>为什么是"玩家数据"而不是物品</h2>
 * 用户明确要求："鱼币要单独一个数据面板，不要搞物品化。"
 * 设计文档（06 §1、09 §3、06 §2、10 §6）也是一致的：鱼币与图鉴同属
 * {@code PlayerFishingData}（NeoForge 的 {@code AttachmentType}），
 * 不是背包里的一种货币物品。
 *
 * <p>做成物品的坏处很具体：占背包格、能被丢弃/放进箱子/被自动化搬走、
 * 要画贴图、要进创造页签、还要处理"两个玩家交易货币"。而鱼币的用途只有
 * "在渔具铺买东西"（后续版本），根本不需要物品的那些性质。
 *
 * <h2>为什么是不可变 record</h2>
 * 附件存的是这个对象本身。如果做成可变类，就得小心"改了字段但没
 * {@code setData} 回去"——那种 bug 表现为"钱扣了但没保存 / 加了但重启就没了"，
 * 而且只在特定路径上出现。做成不可变 + 每次整体替换，就没有"忘记保存"这种状态：
 * 要么换了个新对象（换了就存下了），要么什么都没发生。
 *
 * <h2>存储位置：**每个存档各自一份**（用户要求"鱼币做存档切割"）</h2>
 * 挂在玩家身上，而 NeoForge 的附件是写进**宿主自己的 NBT** 的
 * （{@code AttachmentHolder.ATTACHMENTS_NBT_KEY = "neoforge:attachments"}，
 * 由 {@code serializeAttachments()} 产出）。玩家实体的 NBT 落在
 * {@code <存档目录>/playerdata/<uuid>.dat} —— 存档目录就是世界文件夹。
 *
 * <p>所以：<b>A 档攒了 500 币，换到 B 档还是 0</b>，这正是"存档切割"要的效果。
 * 一个 uuid 在一个存档里只有一份数据；同一个存档无论重进多少次都在。
 *
 * <p>⚠ <b>不要</b>为了"更安全"把它改成 {@code Level} 附件或全局 {@code SavedData}：
 * <ul>
 *   <li>{@code Level} 附件挂在**维度**上 —— 主世界和下界会是两份钱，玩家一进传送门
 *       余额就变，这是纯粹的 bug；</li>
 *   <li>全局 {@code SavedData} 得自己按 UUID 索引玩家，还要处理
 *       "玩家删号了数据还留着"，比现在这层多一堆状态，换不来任何东西。</li>
 * </ul>
 * 玩家级附件恰好就是"存档级 + 按玩家分"，是这件事最省的正确解。
 *
 * <p>（顺带更正：本项目文档 02 §5.2 写的"图鉴数据跨存档跟随玩家"是错的，
 * 与 NeoForge 的实际行为不符 —— 附件从来不会跨存档。）
 */
public record PlayerFishingData(
        /** 鱼币余额。 */
        long coins,
        /**
         * **联赛积分余额**（`docs/39` R6：跨赛季累计、不清零）。
         *
         * <p>与鱼币同域：都是"钱包"，都跟着**存档**走（附件写进玩家自己的 NBT）。
         * 与鱼币的区别只有一处：**联赛积分不参与任何"重置"** ——
         * 结算重置的是"本期成绩"，商店重置的是"本届限购"，积分只增不减 ✓。
         *
         * <p>⚠ 用 {@code optionalFieldOf(..., 0L)}：老存档没有这个字段 ⇒ 读出来 0 ✓（零迁移）。
         */
        long leaguePoints,
        /**
         * 已经领过的图鉴里程碑，**位掩码**：第 i 位 = 第 i 个里程碑已领。
         *
         * <p>为什么必须有这个：里程碑是按完成度发的，而完成度只增不减 ——
         * 没有去重标记的话，每次上鱼都会把"已达到"的所有里程碑再发一遍。
         * 文档里完全没写去重机制，这是实现时必须自己补的一环。
         * （同类先例见 13 §4 的 {@code receivedStarterRod} 标记。）
         */
        int claimedMilestones,
        /** 图鉴：鱼种 id → 该鱼种的记录。没钓到过的鱼种不在表里。 */
        Map<String, CodexEntry> codex,
        /**
         * 第一次进游戏时送的那本教程书**发过没有**。
         *
         * <p>用户 2026-10-02："玩家第一次进入游戏后，自动获得一本教程。"
         * 必须记一个标记：不记的话每次进游戏都会塞一本（背包很快被教程塞满），
         * 而这类"每次登录都发一遍"的 bug 只有玩到第二次才看得见。
         * 用 {@code optionalFieldOf} 给默认值，老存档读进来是 false ——
         * 于是**老玩家下次进游戏也会补发一本**，这正是我们要的（他们也需要新教程）。
         */
        boolean guideGiven,
        /**
         * **大鱼公告**开关（我钓到大鱼要不要公告全服）。
         *
         * <p>用户 2026-10-11：不做"红档信息共享给附近 60 格" ✗、"**公告可以搞**" ✓，
         * 并且定案"必须在设置界面能自由开关，且**持续生效**（退出重进也保留）" ⇒
         * 所以它是**玩家数据**（服务端附件），不是客户端临时开关，也不是服务器配置 ✓。
         *
         * <p>默认值 **true（开）**：默认关的话这个功能没人知道它存在。
         * 老存档没有这个字段 ⇒ {@code optionalFieldOf(..., true)} 读出来就是开 ✓
         * （与 {@code guide_given} 同一个套路，零迁移）。
         */
        boolean bigCatchAnnounce
) {

    /** 空数据（新玩家）。 */
    public static final PlayerFishingData EMPTY =
            new PlayerFishingData(0L, 0L, 0, Map.of(), false, true);

    public static final Codec<PlayerFishingData> CODEC = RecordCodecBuilder.create(inst -> inst.group(
            Codec.LONG.optionalFieldOf("coins", 0L).forGetter(PlayerFishingData::coins),
            // ⚠ 同样必须 optionalFieldOf：老存档没有这个字段 ⇒ 读出 0，而不是整份数据读不出来 ✗
            Codec.LONG.optionalFieldOf("league_points", 0L).forGetter(PlayerFishingData::leaguePoints),
            Codec.INT.optionalFieldOf("claimed_milestones", 0).forGetter(PlayerFishingData::claimedMilestones),
            Codec.unboundedMap(Codec.STRING, CodexEntry.CODEC)
                    .optionalFieldOf("codex", Map.of()).forGetter(PlayerFishingData::codex),
            Codec.BOOL.optionalFieldOf("guide_given", false).forGetter(PlayerFishingData::guideGiven),
            // ⚠ 必须 optionalFieldOf + 默认值 true：用 fieldOf 的话老存档直接读不出来 ✗
            Codec.BOOL.optionalFieldOf("big_catch_announce", true)
                    .forGetter(PlayerFishingData::bigCatchAnnounce)
    ).apply(inst, PlayerFishingData::new));

    // ------------------------------------------------------------------ 鱼币

    public PlayerFishingData withCoins(long v) {
        return new PlayerFishingData(Math.max(0L, v), leaguePoints, claimedMilestones, codex,
                guideGiven, bigCatchAnnounce);
    }

    /** 加鱼币，返回新对象。负数会先把余额夹到 0（不允许透支）。 */
    public PlayerFishingData addCoins(long delta) {
        return withCoins(coins + delta);
    }

    // ------------------------------------------------------------------ 联赛积分

    /** 设置联赛积分（负数夹到 0）。 */
    public PlayerFishingData withLeaguePoints(long v) {
        return new PlayerFishingData(coins, Math.max(0L, v), claimedMilestones, codex, guideGiven,
                bigCatchAnnounce);
    }

    /**
     * 加联赛积分，返回新对象。
     *
     * <p>⚠ **只加不减**（`docs/39` R6："积分作为货币可以累计"）——
     * 兑换的扣分走 {@link #withLeaguePoints(long)} 的显式路径，
     * 这样"哪一处会减少积分"在源码里**只有一处**，检查器好守（见 §8.2 断言）。
     */
    public PlayerFishingData addLeaguePoints(long delta) {
        return withLeaguePoints(leaguePoints + delta);
    }

    /** 标记"教程发过了"。 */
    public PlayerFishingData withGuideGiven() {
        return new PlayerFishingData(coins, leaguePoints, claimedMilestones, codex, true,
                bigCatchAnnounce);
    }

    /** 设置"大鱼公告"开关（界面/指令走这里 ⇒ 只改这一处，别处不会漏字段）。 */
    public PlayerFishingData withBigCatchAnnounce(boolean value) {
        return new PlayerFishingData(coins, leaguePoints, claimedMilestones, codex, guideGiven,
                value);
    }

    // ------------------------------------------------------------------ 图鉴

    public boolean hasCaught(String speciesId) {
        return codex.containsKey(speciesId);
    }

    /** 已点亮的鱼种数。 */
    public int codexCount() {
        return codex.size();
    }

    /**
     * 记一次捕获，返回**新对象**。
     *
     * @param speciesId 鱼种 id
     * @param kg        体重（kg）
     * @param cm        体长（cm）
     * @param tier      品质档位 0–5（**必须单独传**：见 CodexEntry 的说明）
     * @param grade     尺寸评级 ordinal
     * @param gameTime  当前游戏刻
     * @param first     是否是**首次**钓到该鱼种（由调用方先查 hasCaught 决定）
     */
    public PlayerFishingData recordCatch(String speciesId, float kg, float cm, int tier,
                                        int grade, long gameTime, boolean first) {
        Map<String, CodexEntry> next = new HashMap<>(codex);
        CodexEntry old = next.get(speciesId);
        next.put(speciesId, old == null
                ? CodexEntry.first(kg, cm, tier, grade, gameTime)
                : old.merge(kg, cm, tier, grade, gameTime));
        // 首次点亮时，把"首次"这件事的副作用（图鉴完成度奖励）留给调用方处理 ——
        // 这里只负责数据，不负责发钱：发钱的时机与幂等由 CodexRewards 统一管。
        return new PlayerFishingData(coins, leaguePoints, claimedMilestones, Map.copyOf(next),
                guideGiven, bigCatchAnnounce);
    }

    // ------------------------------------------------------------------ 里程碑

    public boolean hasClaimed(int milestoneIndex) {
        return (claimedMilestones & (1 << milestoneIndex)) != 0;
    }

    public PlayerFishingData markClaimed(int milestoneIndex) {
        return new PlayerFishingData(coins, leaguePoints, claimedMilestones | (1 << milestoneIndex),
                codex, guideGiven, bigCatchAnnounce);
    }
}
