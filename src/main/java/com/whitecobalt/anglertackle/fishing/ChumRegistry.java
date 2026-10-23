package com.whitecobalt.anglertackle.fishing;

import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;
import java.util.UUID;

import net.minecraft.core.HolderLookup;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.level.saveddata.SavedData;

/**
 * 全服窝料**名额登记表** —— 用户 2026-10-11 定案：
 * "窝料**同一水体共享** ✓，上限的规则是**全服至多存在 40 个窝料**"。
 *
 * <h2>为什么不能"数一数世界里的窝料实体"</h2>
 * 因为窝料的寿命是 {@code ChumItem.durationMinutes()} **分钟**（30~300 分钟档，
 * 见 {@code Config} 的 {@code [chum]} 组注释），一条窝子要活几个小时。
 * 而 {@code level.getEntities()} 只数**已加载区块**里的实体 ⇒ 玩家走远一点、
 * 区块卸载，那几十条窝子就"查不到"了 ⇒ 上限形同虚设 ✗（而那正是要防的刷法）。
 *
 * <p>所以这里记的是**名额**：抛出时登记一条 {@code uuid → 到期时刻}，
 * 到期自动作废（{@link #prune}），实体被提前清掉（{@code /kill}、爆炸）时由
 * {@code ChumEntity.remove} 立刻释放。**"+40 个窝料"数的是没到期的名额** ✓。
 *
 * <h2>兼容性</h2>
 * 老存档没有这个文件 ⇒ 读出空表 ⇒ 上限从不触发 ✓（已有的窝子不占名额，
 * 它们自己到期后世界就与现在一致）。删掉本文件也只是"上限重新从 0 数" ✓，
 * 不影响任何钓鱼判定 ✓。
 *
 * <p>⚠ {@code UNLOADED_TO_CHUNK} / {@code UNLOADED_WITH_PLAYER} / {@code CHANGED_DIMENSION}
 * **不释放名额** —— 那三种情况下窝子都还**存在**（在区块存档里 / 在别的维度），
 * 只是暂时不在内存里。释放了就等于"把窝子扔在远处再回来又能多打 40 个"✗。
 */
public class ChumRegistry extends SavedData {

    /** 存档文件名（`data/anglertackle_chum.dat`）。**不许改名**。 */
    public static final String FILE_ID = "anglertackle_chum";

    /** 窝料 UUID → 到期时刻（主世界 gameTime）。 */
    private final Map<UUID, Long> live = new HashMap<>();

    public static ChumRegistry load(CompoundTag tag, HolderLookup.Provider registries) {
        ChumRegistry d = new ChumRegistry();
        CompoundTag map = tag.getCompoundOrEmpty("live");
        for (String key : map.keySet()) {
            try {
                d.live.put(UUID.fromString(key), map.getLongOr(key, 0L));
            } catch (IllegalArgumentException ignored) {
                // 坏数据（手改过存档 / 版本迁移）只跳过这一条，绝不让读档失败
            }
        }
        return d;
    }

    @Override
    public CompoundTag save(CompoundTag tag, HolderLookup.Provider registries) {
        CompoundTag map = new CompoundTag();
        for (Map.Entry<UUID, Long> e : this.live.entrySet()) {
            map.putLong(e.getKey().toString(), e.getValue());
        }
        tag.put("live", map);
        return tag;
    }

    /** 全服共一份 —— 存在主世界（与排行榜、慢性风险账本同一个入口形态）。 */
    public static ChumRegistry get(ServerLevel level) {
        return level.getDataStorage().computeIfAbsent(
                new SavedData.Factory<>(ChumRegistry::new, ChumRegistry::load),
                FILE_ID);
    }

    public static ChumRegistry get(MinecraftServer server) {
        return get(server.overworld());
    }

    /** 上限（格数 / 条数都走调参器，用户可以自己改）。 */
    public static int cap() {
        return Tuning.chumServerCap();
    }

    /** 清掉已到期的名额。**每次查/加都先清** ⇒ 不需要额外的定时器。 */
    public void prune(long now) {
        boolean changed = false;
        Iterator<Map.Entry<UUID, Long>> it = this.live.entrySet().iterator();
        while (it.hasNext()) {
            if (it.next().getValue() <= now) {
                it.remove();
                changed = true;
            }
        }
        if (changed) {
            this.setDirty();
        }
    }

    /** 当前**占用中的名额数**（已到期的先清掉）。 */
    public int count(long now) {
        prune(now);
        return this.live.size();
    }

    /**
     * 占一个名额。
     *
     * @return {@code true} = 占到了（调用方可以生成窝料实体）；
     *         {@code false} = **已满**（调用方不该生成实体，也不该扣物品）
     */
    public boolean reserve(UUID chum, long now, long expireAt) {
        if (chum == null) {
            return false;
        }
        prune(now);
        if (this.live.size() >= cap()) {
            return false;
        }
        this.live.put(chum, expireAt);
        this.setDirty();
        return true;
    }

    /** 提前释放（实体被清掉时）。 */
    public void release(UUID chum) {
        if (chum != null && this.live.remove(chum) != null) {
            this.setDirty();
        }
    }
}
