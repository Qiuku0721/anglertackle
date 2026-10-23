package com.whitecobalt.anglertackle.recipe;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import com.mojang.serialization.Codec;
import com.mojang.serialization.codecs.RecordCodecBuilder;
import net.minecraft.core.UUIDUtil;
import net.minecraft.resources.Identifier;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.level.saveddata.SavedData;
import net.minecraft.world.level.saveddata.SavedDataType;

/**
 * 慢性风险的**累积计数**（汞 / 雪卡 / 二噁英）—— 用户 2026-10-11 定案 C①："**累积型**：
 * 吃够 N 次触发一次，**不每次必中**"。
 *
 * <p>现实依据（见 {@code docs/料理适配策划案.md} §3）：裸盖鱼（"银鳕鱼"）有婴幼儿血汞异常报道、
 * 雨伞旗鱼多篇论文记汞生物富集、鲯鳅有雪卡、鲱鱼罐头有二噁英提示。
 * 这些**都不是"吃一口就中毒"** ✓ —— 所以做成累积 ✓，最贴事实 ✓。
 *
 * <h2>⚠⚠ 为什么用世界级 {@link SavedData}，而不是给玩家附件加字段</h2>
 * 这是**老功能**（做菜早就在跑，老存档里躺着老数据），用户明确要求"**别连代码都不会兼容**"。
 * 给 {@code PlayerFishingData} 那个 record 加字段看着简单，但那个类**每次修改都要重建整个 record**
 * （{@code recordCatch} / {@code withCoins} / {@code markClaimed} …）——
 * 漏掉任何一处构造点，新字段就会被**静默重置**：编译能过、不报错、数据就是不变
 * （那个文件自己的注释就在警告这个坑）。所以这里走世界级存档：
 * <ul>
 *   <li>老存档**根本没有这个文件** ⇒ 读出来就是空表 ✓ 从 0 开始 ✓ 完全兼容 ✓；</li>
 *   <li>碰不到 {@code PlayerFishingData} / 附件 / 任何既有存档格式 ✓；</li>
 *   <li>与 {@code LeaderboardData} 同一个套路 ✓（那份已经过闸 ✓）。</li>
 * </ul>
 *
 * <p>⚠ 这份数据**只加不减也不参与任何判定**：删掉它，玩法与现在逐字一致 ✓
 * （即时负面来自 {@link FishPalatability#biteOf} ✓，与本文件无关 ✓）。
 */
public class PalatabilityLedger extends SavedData {

    /** 存档文件名（`data/<namespace>/anglertackle_palatability.dat`）。**不许改名** —— 改名 = 老存档的计数全丢。 */
    public static final String FILE_ID = "anglertackle_palatability";

    /** 吃够多少次才触发一次。**这个数字是"慢性"的全部含义** —— 调它等于调这条机制的强度。 */
    public static final int THRESHOLD = 10;

    /**
     * 风险种类 → 已吃次数。**NBT 布局与旧 {@code save()/load()} 逐字一致**：
     * 旧版是 {@code risks} 这个 CompoundTag（键 = 风险字符串，值 = int），
     * 等价于 {@code Codec.unboundedMap(Codec.STRING, Codec.INT)}。
     *
     * <p>⚠ 旧 {@code load} 会**丢掉 <= 0 的项**（{@code if (v > 0)}），这里用 {@code xmap}
     * 在解码方向保留同一过滤；编码方向原样写出（内存里本来就不会有 0）。
     */
    private static final Codec<Map<String, Integer>> RISKS_CODEC =
            Codec.unboundedMap(Codec.STRING, Codec.INT).xmap(PalatabilityLedger::positiveOnly, m -> m);

    /** 存档里的一条 {uuid, risks}。旧版是先读 uuid、再读 risks 表。 */
    private record PlayerCounts(UUID player, Map<String, Integer> risks) {
        private static final Codec<PlayerCounts> CODEC = RecordCodecBuilder.create(inst -> inst.group(
                UUIDUtil.CODEC.fieldOf("uuid").forGetter(PlayerCounts::player),
                RISKS_CODEC.optionalFieldOf("risks", Map.of()).forGetter(PlayerCounts::risks)
        ).apply(inst, PlayerCounts::new));
    }

    /**
     * 整份存档的 codec —— **顶层键 {@code players} 与旧版同名同类型**（list of compound）。
     * 旧版会跳过"risks 为空"的玩家，这里在读写两侧都保持这个口径（空表不落盘）。
     */
    public static final Codec<PalatabilityLedger> CODEC = RecordCodecBuilder.create(inst -> inst.group(
            PlayerCounts.CODEC.listOf().optionalFieldOf("players", List.of())
                    .forGetter(PalatabilityLedger::playerCounts)
    ).apply(inst, PalatabilityLedger::new));

    /** 26.1.2 的 SavedDataType；文件名仍叫 {@code anglertackle_palatability.dat}。 */
    public static final SavedDataType<PalatabilityLedger> TYPE = new SavedDataType<>(
            Identifier.withDefaultNamespace(FILE_ID), PalatabilityLedger::new, CODEC);

    /** 玩家 → （风险种类 → 已吃次数）。风险种类见 {@link FishPalatability#chronicRisk}。 */
    private final Map<UUID, Map<String, Integer>> counts = new HashMap<>();

    public PalatabilityLedger() {
    }

    /** codec 读档入口：与旧读法同口径（空表跳过、同 UUID 后者覆盖）。 */
    private PalatabilityLedger(List<PlayerCounts> players) {
        for (PlayerCounts p : players) {
            if (!p.risks().isEmpty()) {
                this.counts.put(p.player(), new HashMap<>(p.risks()));
            }
        }
    }

    /** 旧 load 里的 {@code if (v > 0)}。 */
    private static Map<String, Integer> positiveOnly(Map<String, Integer> raw) {
        Map<String, Integer> out = new HashMap<>();
        for (Map.Entry<String, Integer> e : raw.entrySet()) {
            if (e.getValue() != null && e.getValue() > 0) {
                out.put(e.getKey(), e.getValue());
            }
        }
        return out;
    }

    /** 写出用：与旧 save 一样，**清零的玩家不往存档里写垃圾**。 */
    private List<PlayerCounts> playerCounts() {
        List<PlayerCounts> out = new ArrayList<>();
        for (Map.Entry<UUID, Map<String, Integer>> e : this.counts.entrySet()) {
            if (e.getValue().isEmpty()) {
                continue;
            }
            out.add(new PlayerCounts(e.getKey(), Map.copyOf(e.getValue())));
        }
        return out;
    }

    /** 取（或建）主世界那份 —— 与排行榜同一个入口形态（只有 {@code MinecraftServer} 时也够用）。 */
    public static PalatabilityLedger get(ServerLevel level) {
        return level.getDataStorage().computeIfAbsent(TYPE);
    }

    public static PalatabilityLedger get(MinecraftServer server) {
        return get(server.overworld());
    }

    /**
     * 记一次"吃了带这种慢性风险的东西"。
     *
     * @return {@code true} = **这一次正好吃够了**，调用方该发一次慢性负面；
     *         计数会同时清零，重新开始数（所以不是"以后每次都有"）。
     */
    public boolean bump(UUID player, String risk) {
        if (player == null || risk == null || risk.isEmpty()) {
            return false;
        }
        Map<String, Integer> m = this.counts.computeIfAbsent(player, (k) -> new HashMap<>());
        int n = m.getOrDefault(risk, 0) + 1;
        this.setDirty();
        if (n >= THRESHOLD) {
            m.remove(risk);
            return true;
        }
        m.put(risk, n);
        return false;
    }

    /** 只读：某个玩家某种风险已经吃了多少次（检查器 / 指令用）。 */
    public int countOf(UUID player, String risk) {
        Map<String, Integer> m = this.counts.get(player);
        return m == null ? 0 : m.getOrDefault(risk, 0);
    }
}
