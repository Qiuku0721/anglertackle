package com.whitecobalt.anglertackle.player;

import com.mojang.serialization.Codec;
import com.mojang.serialization.codecs.RecordCodecBuilder;
import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.codec.ByteBufCodecs;
import net.minecraft.network.codec.StreamCodec;

import java.util.HashMap;
import java.util.Map;

/**
 * 垂纶进度：等级 / 经验、有没有说过第一句话、限购商品的库存状态。
 *
 * <h2>为什么单独一个附件，而不是塞进 {@link PlayerFishingData}</h2>
 * {@code PlayerFishingData} 是 record，加字段要改它的 Codec 和所有构造点；
 * 而这两块数据**没有任何共同的生命周期**（鱼币/图鉴是钓鱼产出，这里是等级与 NPC 交互）。
 * 混在一起只会让两边都难改 —— 而且它已经存进存档了，动它的 Codec 有迁移风险。
 *
 * <h2>等级语义（2026-10-02 改）</h2>
 * 这里是**垂纶等级 1–50** 与经验，规则全在 {@link AnglerLeveling}：
 * 每条鱼按品质给经验，10/20/30/40 级要交鱼才能继续升（不交就卡住、经验不积攒）。
 *
 * <p>老柯那边的"档位"（{@code stage}）**不再单独存**，而是由等级推导
 * （{@link AnglerLeveling#stageFor}）—— 存两份的话迟早出现"升了级但商店没解锁"。
 *
 * <h2>老存档迁移（重要）</h2>
 * 旧存档里只有 {@code stage}（1–5，靠交鱼推进），没有 level/xp。
 * 迁移在 {@link #CODEC} 里做：{@code level} 取
 * {@code max(存档里的 level, (stage-1)*10 + 1)} —— 一个已经把五次评定都做完的
 * 老玩家（stage 5）迁移后是 41 级，商店该解锁的都还解锁着，
 * 不会出现"读档之后老柯又不肯卖东西了"。
 *
 * <h2>限购</h2>
 * {@code stock} 的键是物品 id（如 {@code pe_line}），值是"买了几个 + 什么时候补货"。
 * 用户定的规则：金鱼线每买 5 个售罄、等 120 分钟；红鱼线每次兑换后等 120 分钟。
 *
 * <p><b>为什么记 gameTime 而不是现实时间</b>：游戏时间是随存档走的 ——
 * 玩家退出游戏的那段时间不该算作"补货等待"，否则关掉游戏睡一觉回来就白拿。
 * 用现实时间的话，改系统时钟就能刷货。
 */
public record FishermanProgress(int level, int xp, boolean talked, Map<String, Stock> stock) {

    /** 最高档位（下界合金）。 */
    public static final int MAX_STAGE = 5;

    /** 还没跟老柯说过话、刚开局。 */
    public static final FishermanProgress EMPTY = new FishermanProgress(1, 0, false, Map.of());

    /**
     * 一件限购商品的库存。
     *
     * @param bought    本轮已经买了几个
     * @param restockAt 什么时候补货（{@code Level.getGameTime()}）；0 = 不需要补货
     */
    public record Stock(int bought, long restockAt) {
        public static final Codec<Stock> CODEC = RecordCodecBuilder.create(inst -> inst.group(
                Codec.INT.fieldOf("bought").orElse(0).forGetter(Stock::bought),
                Codec.LONG.fieldOf("restockAt").orElse(0L).forGetter(Stock::restockAt)
        ).apply(inst, Stock::new));

        public static final StreamCodec<RegistryFriendlyByteBuf, Stock> STREAM_CODEC =
                StreamCodec.composite(
                        ByteBufCodecs.VAR_INT, Stock::bought,
                        ByteBufCodecs.VAR_LONG, Stock::restockAt,
                        Stock::new);
    }

    public static final Codec<FishermanProgress> CODEC = RecordCodecBuilder.create(inst -> inst.group(
            Codec.INT.fieldOf("level").orElse(1).forGetter(FishermanProgress::level),
            Codec.INT.fieldOf("xp").orElse(0).forGetter(FishermanProgress::xp),
            Codec.BOOL.fieldOf("talked").orElse(false).forGetter(FishermanProgress::talked),
            Codec.unboundedMap(Codec.STRING, Stock.CODEC).fieldOf("stock")
                    .orElse(Map.of()).forGetter(FishermanProgress::stock),
            // ⚠ 老存档迁移：旧格式只有 stage（1–5），没有 level。
            //   读进来按"档位至少对应多少级"抬一下，见类注释。
            Codec.INT.fieldOf("stage").orElse(1).forGetter((FishermanProgress p) -> p.stage())
    ).apply(inst, (level, xp, talked, stock, legacyStage) -> new FishermanProgress(
            Math.max(level, AnglerLeveling.levelFloorForStage(legacyStage)), xp, talked, stock)));

    public static final StreamCodec<RegistryFriendlyByteBuf, FishermanProgress> STREAM_CODEC =
            StreamCodec.composite(
                    ByteBufCodecs.VAR_INT, FishermanProgress::level,
                    ByteBufCodecs.VAR_INT, FishermanProgress::xp,
                    ByteBufCodecs.BOOL, FishermanProgress::talked,
                    ByteBufCodecs.map(HashMap::new, ByteBufCodecs.STRING_UTF8, Stock.STREAM_CODEC),
                    FishermanProgress::stock,
                    FishermanProgress::new);

    // ---------------------------------------------------------------- 等级与经验
    public FishermanProgress withTalked() {
        return new FishermanProgress(level, xp, true, stock);
    }

    /** 老柯的商店档位（1–5）——由等级推导，不再单独存。 */
    public int stage() {
        return AnglerLeveling.stageFor(level);
    }

    /** 满级了吗。 */
    public boolean maxLevel() {
        return level >= AnglerLeveling.MAX_LEVEL;
    }

    /** 现在是不是卡在评定点（10/20/30/40）：是的话经验不积攒。 */
    public boolean atGate() {
        return AnglerLeveling.isGate(level);
    }

    /** 升级到下一级还需要多少经验；满级或卡级返回 0。 */
    public int xpToNext() {
        return atGate() ? 0 : AnglerLeveling.xpToNext(level);
    }

    /**
     * 吃进 {@code amount} 点经验，返回"涨完之后的进度"以及升了几级。
     *
     * <p>三条规则（用户原话）：
     * <ul>
     *   <li>卡在 10/20/30/40 时**一点经验都不收**（"不积攒经验"）——所以是直接返回。</li>
     *   <li>升级需要 {@link AnglerLeveling#xpToNext}；升上去之后**继续结算剩余经验**
     *       （一条红鱼 58 点，在 1 级时能连升好几级）。</li>
     *   <li>升级途中撞到评定点就**停在那里**，多余的经验丢掉 —— 因为那一段本来就不该积累。</li>
     * </ul>
     * 返回值用一个记录带着"升了几级"，调用方好决定播不播提示音。
     */
    public record Gain(FishermanProgress next, int levelsGained, int xpAccepted) {
    }

    public Gain gainXp(int amount) {
        if (amount <= 0 || maxLevel() || atGate()) {
            return new Gain(this, 0, 0);
        }
        int lv = level;
        int cur = xp + amount;
        int accepted = amount;
        int gained = 0;
        while (lv < AnglerLeveling.MAX_LEVEL) {
            if (AnglerLeveling.isGate(lv)) {
                // 撞上评定点：经验清零停住，多余的直接丢
                return new Gain(new FishermanProgress(lv, 0, talked, stock), gained, accepted);
            }
            int need = AnglerLeveling.xpToNext(lv);
            if (cur < need) {
                break;
            }
            cur -= need;
            lv++;
            gained++;
        }
        if (lv >= AnglerLeveling.MAX_LEVEL) {
            return new Gain(new FishermanProgress(AnglerLeveling.MAX_LEVEL, 0, talked, stock), gained, accepted);
        }
        return new Gain(new FishermanProgress(lv, cur, talked, stock), gained, accepted);
    }

    /**
     * 突破：把等级推过当前评定点（10→11 / 20→21 / 30→31 / 40→41）。
     *
     * <p>只有**正好卡在评定点**时才有效（否则原样返回）—— 判定材料的逻辑在
     * {@code ShopManager}，这里只负责推进等级，避免"交了鱼但等级没动"这种事情
     * 散在两个地方各写一遍。
     */
    public FishermanProgress breakthrough() {
        if (!atGate()) {
            return this;
        }
        return new FishermanProgress(level + 1, 0, talked, stock);
    }

    /** 某件商品解锁了没有。 */
    public boolean unlocked(int unlockStage) {
        return stage() >= unlockStage;
    }

    // ---------------------------------------------------------------- 限购
    public Stock stockOf(String id) {
        return stock.getOrDefault(id, new Stock(0, 0L));
    }

    /** 写回一件商品的库存。 */
    public FishermanProgress withStock(String id, Stock s) {
        Map<String, Stock> m = new HashMap<>(stock);
        if (s.bought() == 0 && s.restockAt() == 0L) {
            m.remove(id);   // 归零就删掉，别让存档里堆一堆没用的键
        } else {
            m.put(id, s);
        }
        return new FishermanProgress(level, xp, talked, Map.copyOf(m));
    }

    /**
     * 算"现在这件商品还能不能买"，顺便把过期的售罄状态清掉。
     *
     * @param stockPer       每买几个售罄（0 = 不限购）
     * @param restockMinutes 售罄后等几分钟（0 = 不限购）
     * @param gameTime       当前 {@code Level.getGameTime()}
     * @return 可以买返回 true
     */
    public boolean canBuy(String id, int stockPer, int restockMinutes, long gameTime) {
        if (stockPer <= 0 || restockMinutes <= 0) {
            return true;   // 不限购
        }
        Stock s = stockOf(id);
        if (s.restockAt() > 0L) {
            return gameTime >= s.restockAt();   // 售罄中，等补货
        }
        return s.bought() < stockPer;
    }

    /**
     * 买完一个之后的新库存。
     *
     * <p>"买了 5 个售罄"里的 5 是**累计**，所以买到第 5 个时就把补货时间写上；
     * 补货时间一到，{@link #resetIfRestocked} 会把计数清零重新开始。
     */
    public FishermanProgress afterBuy(String id, int stockPer, int restockMinutes, long gameTime) {
        if (stockPer <= 0 || restockMinutes <= 0) {
            return this;
        }
        Stock s = stockOf(id);
        int bought = s.bought() + 1;
        if (bought >= stockPer) {
            // 售罄：记下补货时刻（20 tick = 1 秒，所以分钟 ×1200）
            return withStock(id, new Stock(stockPer, gameTime + (long) restockMinutes * 1200L));
        }
        return withStock(id, new Stock(bought, 0L));
    }

    /** 补货时间到了就把计数清零。每 tick 或每次开店时调一次都行（幂等）。 */
    public FishermanProgress resetIfRestocked(String id, long gameTime) {
        Stock s = stockOf(id);
        if (s.restockAt() > 0L && gameTime >= s.restockAt()) {
            return withStock(id, new Stock(0, 0L));
        }
        return this;
    }

    /** 还要等多久补货（tick）；不需要等待返回 0。UI 上显示倒计时用。 */
    public long restockWait(String id, long gameTime) {
        Stock s = stockOf(id);
        return s.restockAt() > gameTime ? s.restockAt() - gameTime : 0L;
    }
}
