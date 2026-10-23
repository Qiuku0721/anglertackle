package com.whitecobalt.anglertackle.recipe;

import java.util.HashMap;
import java.util.Map;

import net.minecraft.core.BlockPos;
import net.minecraft.core.HolderLookup;
import net.minecraft.core.registries.Registries;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.nbt.ListTag;
import net.minecraft.nbt.Tag;
import net.minecraft.resources.ResourceKey;
import net.minecraft.resources.Identifier;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.saveddata.SavedData;

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

    /** 存档文件名（`data/anglertackle_fermenting.dat`）。**不许改名**。 */
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
            return this.dimension.location() + "@" + this.pos.asLong();
        }
    }

    private final Map<String, Entry> pending = new HashMap<>();

    public static FermentingData load(CompoundTag tag, HolderLookup.Provider registries) {
        FermentingData d = new FermentingData();
        ListTag list = tag.getList("pending", Tag.TAG_COMPOUND);
        for (int i = 0; i < list.size(); i++) {
            CompoundTag e = list.getCompound(i);
            Identifier dim = Identifier.tryParse(e.getString("dim"));
            if (dim == null) {
                continue;   // 老/坏数据：跳过这一条，读档绝不因为这里崩
            }
            BlockPos pos = BlockPos.of(e.getLong("pos"));
            Entry entry = new Entry(ResourceKey.create(Registries.DIMENSION, dim), pos, e.getLong("start"));
            d.pending.put(entry.key(), entry);
        }
        return d;
    }

    @Override
    public CompoundTag save(CompoundTag tag, HolderLookup.Provider registries) {
        ListTag list = new ListTag();
        for (Entry e : this.pending.values()) {
            CompoundTag t = new CompoundTag();
            t.putString("dim", e.dimension.location().toString());
            t.putLong("pos", e.pos.asLong());
            t.putLong("start", e.startTick);
            list.add(t);
        }
        tag.put("pending", list);
        return tag;
    }

    public static FermentingData get(ServerLevel level) {
        return level.getDataStorage().computeIfAbsent(
                new SavedData.Factory<>(FermentingData::new, FermentingData::load),
                FILE_ID);
    }

    public static FermentingData get(MinecraftServer server) {
        return get(server.overworld());
    }

    /** 记一条（右键木桶时调；同一个桶重复记会把开始时间**保留成最早那次** ✓）。 */
    public void remember(ResourceKey<Level> dimension, BlockPos pos, long now) {
        String k = dimension.location() + "@" + pos.asLong();
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
