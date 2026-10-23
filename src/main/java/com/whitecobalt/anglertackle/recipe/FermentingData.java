package com.whitecobalt.anglertackle.recipe;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import com.mojang.serialization.Codec;
import com.mojang.serialization.codecs.RecordCodecBuilder;
import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.Registries;
import net.minecraft.resources.Identifier;
import net.minecraft.resources.ResourceKey;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.saveddata.SavedData;
import net.minecraft.world.level.saveddata.SavedDataType;

/**
 * 「正在发酵的木桶」清单 —— 用户 2026-10-11 定案的做法：
 * **把鱼放进原版木桶、一天之后成品直接出现替换该鱼，但鱼的数据不变**。
 *
 * <h2>为什么需要这份清单（而不是让木桶自己 tick）</h2>
 * ⚠ 我**打开真 jar 查过**（`.gradle-home` 里的 `neoforge-21.1.252-universal.jar`）：
 * {@code net/neoforged/neoforge/event/tick/} 下**只有** Entity / Level / Player / Server 四种 tick，
 * **没有 {@code BlockEntityTickEvent}** ✗。所以"让原版木桶自己 tick"这条路**不存在**，
 * 而"每 tick 遍历世界里所有方块实体"更不行 ✗ —— 那正是这个仓库最忌讳的
 * （{@code check-dish-effect-hooks} 里就有一条 {@code oresight-no-chunk-guard
 * 会为了找矿强加载区块，卡服}）。
 *
 * <p>所以走**清单**：右键木桶那一刻只记一条 {@code (维度, 坐标, 开始刻)} ✓（O(1)），
 * 之后每 20 tick **只遍历这份清单**（通常 0~几条）✓ —— **代价与发酵中的桶数成正比，
 * 与世界大小无关** ✓。
 *
 * <h2>为什么用世界级 SavedData</h2>
 * 中途退出游戏再进来，发酵**不该从头算** ✓（用户要的是"一天"，不是"在线一天" ✗）。
 * 与 {@code LeaderboardData} / {@code PalatabilityLedger} 同一个套路 ✓，
 * 而且**完全不碰**任何既有存档格式 ✓（老存档没有这个文件 ⇒ 读出来就是空清单 ✓）。
 */
public class FermentingData extends SavedData {

    /** 存档文件名（26.1.2 起落在 `data/<namespace>/anglertackle_fermenting.dat`，见 {@link #TYPE}）。**不许改名**。 */
    public static final String FILE_ID = "anglertackle_fermenting";

    /** 发酵时长：**一天**（用户口径）= 24000 游戏刻。 */
    public static final long DURATION_TICKS = 24000L;

    /** 一条待发酵记录。 */
    public static final class Entry {
        public final ResourceKey<Level> dimension;
        public final BlockPos pos;
        public final long startTick;

        public Entry(ResourceKey<Level> dimension, BlockPos pos, long startTick) {
            this.dimension = dimension;
            this.pos = pos;
            this.startTick = startTick;
        }

        /** 清单的键：同维度同坐标只留一条（重复右键同一个桶不该叠加 ✓）。 */
        public String key() {
            return this.dimension.identifier() + "@" + this.pos.asLong();
        }
    }

    /**
     * 一条记录的 codec —— **NBT 键与旧 {@code save()/load()} 逐字一致**：
     * {@code dim}（string）/ {@code pos}（long）/ {@code start}（long）。
     * 缺 {@code pos}/{@code start} 时按旧读法取 0（{@code getLongOr(..., 0)}）。
     */
    private static final Codec<Entry> ENTRY_CODEC = RecordCodecBuilder.create(inst -> inst.group(
            Identifier.CODEC.fieldOf("dim").forGetter(e -> e.dimension.identifier()),
            Codec.LONG.optionalFieldOf("pos", 0L).forGetter(e -> e.pos.asLong()),
            Codec.LONG.optionalFieldOf("start", 0L).forGetter(e -> e.startTick)
    ).apply(inst, (dim, pos, start) ->
            new Entry(ResourceKey.create(Registries.DIMENSION, dim), BlockPos.of(pos), start)));

    /** 整份存档的 codec：{@code pending} = 旧存档里那张 list（元素键逐字不变）。 */
    public static final Codec<FermentingData> CODEC = RecordCodecBuilder.create(inst -> inst.group(
            ENTRY_CODEC.listOf().optionalFieldOf("pending", List.of())
                    .forGetter(d -> List.copyOf(d.pending.values()))
    ).apply(inst, FermentingData::new));

    /**
     * 26.1.2 的 SavedDataType（`SavedData` 自己已经不带 save/load 了）。
     *
     * <p>⚠ 文件路径：{@code SavedDataStorage#getDataFile} 现在按
     * {@code dataFolder.resolve(id.getNamespace(), id.getPath())} 取文件 ⇒ 平台必然多一层命名空间目录。
     * 这里用 {@code withDefaultNamespace(FILE_ID)} 保住**文件名一个字不变**
     * （{@code anglertackle_fermenting.dat}），只多了 {@code minecraft/} 这一层。
     */
    public static final SavedDataType<FermentingData> TYPE = new SavedDataType<>(
            Identifier.withDefaultNamespace(FILE_ID), FermentingData::new, CODEC);

    private final Map<String, Entry> pending = new HashMap<>();

    public FermentingData() {
    }

    /** codec 读档入口：重复键按旧读法"后写覆盖先写"（{@code put}）。 */
    private FermentingData(List<Entry> entries) {
        for (Entry e : entries) {
            this.pending.put(e.key(), e);
        }
    }

    public static FermentingData get(ServerLevel level) {
        return level.getDataStorage().computeIfAbsent(TYPE);
    }

    public static FermentingData get(MinecraftServer server) {
        return get(server.overworld());
    }

    /** 记一条（右键木桶时调；同一个桶重复记会把开始时间**保留成最早那次** ✓）。 */
    public void remember(ResourceKey<Level> dimension, BlockPos pos, long now) {
        String k = dimension.identifier() + "@" + pos.asLong();
        if (this.pending.containsKey(k)) {
            return;   // 已经记过了 —— 不许刷新开始时间，否则玩家反复右键就永远不发效 ✗
        }
        this.pending.put(k, new Entry(dimension, pos, now));
        this.setDirty();
    }

    public void forget(String key) {
        if (this.pending.remove(key) != null) {
            this.setDirty();
        }
    }

    /** 只读视图（tick 扫描与检查器用）。 */
    public Map<String, Entry> pending() {
        return Map.copyOf(this.pending);
    }
}
