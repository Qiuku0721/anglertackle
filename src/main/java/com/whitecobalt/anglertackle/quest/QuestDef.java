package com.whitecobalt.anglertackle.quest;

import java.util.List;

/**
 * 一条**委托定义**（老柯的每日 / 周常任务；策划 `docs/40` §4/§5）。
 *
 * <h2>为什么用"模板 + 参数"而不是给每条任务写一个类</h2>
 * 照 `docs/39` §5"生成式称号"的教训：任务池是会**持续增删**的表，
 * 每条写一个类的话，加一条任务就要动代码、加断言、重新配负例；
 * 用 {@code goal + args} 之后，加任务只是往 {@link QuestPool} 的表里加一行 ✓。
 *
 * <h2>奖励：**二选一**（用户 2026-10-14 第 3 条："如果奖励饵料就别给鱼币"）</h2>
 * 一条委托**要么给鱼币、要么给物品**，不许两个都给 ——
 * {@code check-quest.js} 会断言这一点（出现"两个都有"就判红）✓。
 *
 * @param id       稳定 id（存进玩家附件；**永不改名**，改的是语言文件里的中文名）
 * @param period   周期（每日 / 周常）
 * @param goal     判定目标类型（见 {@link Goal}）
 * @param args     目标参数（**只放 id 与数字**，含义按 {@link Goal} 逐个约定，见 {@link QuestPool}）
 * @param coins    奖励鱼币（0 = 不给鱼币）
 * @param itemId   奖励物品 id（空串 = 不给物品；**与 {@code coins} 二选一**）
 * @param itemCount 奖励物品数量（配合 {@code itemId}）
 * @param minLevel 抽池的等级门槛（低等级抽不到高难委托）
 * @param weight   抽中权重（越大越常见）
 */
public record QuestDef(
        String id,
        Period period,
        Goal goal,
        List<String> args,
        long coins,
        String itemId,
        int itemCount,
        int minLevel,
        int weight) {

    /** 周期：**每日 = 每游戏日**（天明刷新）/ 周常 = 每 7 游戏日。 */
    public enum Period {
        DAILY,
        WEEKLY
    }

    /**
     * 判定目标类型 —— **每一种的 {@code args} 约定**（照 `docs/40` §4 的表）：
     *
     * <ul>
     *   <li>{@link #GET_COUNT} —— {@code args = [n]}：累计钓到 n 条；</li>
     *   <li>{@link #GET_TIER_COUNT} —— {@code args = [tier, n]}：钓到 n 条**品质 ≥ tier**（tier 0 起算，见 `AGENTS.md` §二）；</li>
     *   <li>{@link #GET_SPECIES} —— {@code args = [speciesId, n]}：钓到指定鱼种 n 条；</li>
     *   <li>{@link #GET_SPECIES_SET} —— {@code args = [id1, id2, id3]}：**集齐**这几个鱼种各 1 条；</li>
     *   <li>{@link #GET_WEIGHT_SUM} —— {@code args = [kg]}：累计重量 ≥ kg；</li>
     *   <li>{@link #GET_BIGGEST} —— {@code args = [kg]}：单条 ≥ kg；</li>
     *   <li>{@link #GET_LONGEST} —— {@code args = [cm]}：单条长度 ≥ cm；</li>
     *   <li>{@link #GET_ROD_TYPE} —— {@code args = [float|lure|both, n]}：用指定竿型钓到 n 条；</li>
     *   <li>{@link #GET_VARIETY} —— {@code args = [n]}：钓到 n 种**不同**的鱼。</li>
     * </ul>
     */
    public enum Goal {
        GET_COUNT,
        GET_TIER_COUNT,
        GET_SPECIES,
        GET_SPECIES_SET,
        GET_WEIGHT_SUM,
        GET_BIGGEST,
        GET_LONGEST,
        GET_ROD_TYPE,
        GET_VARIETY
    }

    /** 给物品吗。 */
    public boolean givesItem() {
        return itemId != null && !itemId.isEmpty() && itemCount > 0;
    }

    /** 给鱼币吗。 */
    public boolean givesCoins() {
        return coins > 0L;
    }

    /** ⚠ 二选一：**恰好一种**（两个都没有也非法 —— `check-quest.js` 两种都判红）。 */
    public boolean rewardIsExactlyOne() {
        return givesCoins() ^ givesItem();
    }

    /** 取第 {@code i} 个参数，越界给空串（判定方自己兜底，不抛异常）。 */
    public String arg(int i) {
        return i >= 0 && i < args.size() ? args.get(i) : "";
    }

    /** 取第 {@code i} 个参数当整数；非法给 {@code fallback}。 */
    public int argInt(int i, int fallback) {
        try {
            return Integer.parseInt(arg(i).trim());
        } catch (RuntimeException e) {
            return fallback;
        }
    }

    /** 取第 {@code i} 个参数当小数；非法给 {@code fallback}。 */
    public double argDouble(int i, double fallback) {
        try {
            return Double.parseDouble(arg(i).trim());
        } catch (RuntimeException e) {
            return fallback;
        }
    }
}
