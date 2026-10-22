package com.whitecobalt.anglertackle.event;

import com.whitecobalt.anglertackle.AnglersTackle;
import com.whitecobalt.anglertackle.recipe.FermentingData;
import com.whitecobalt.anglertackle.registry.ModItems;

import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.BarrelBlock;
import net.minecraft.world.level.block.entity.BarrelBlockEntity;
import net.minecraft.world.level.block.entity.BlockEntity;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.event.entity.player.PlayerInteractEvent;
import net.neoforged.neoforge.event.tick.LevelTickEvent;

/**
 * 「木桶发酵」—— 用户 2026-10-11 定案：
 * **把鱼放进原版木桶、一天之后成品直接出现替换该鱼，但鱼的数据不变**。
 *
 * <p>这条设计**替掉了**我先前那个用盐腌的配方 —— 那个是我编的 ✗：
 * 格陵兰鲨的传统做法（hákarl）是**埋进沙坑压石头、等 6~12 周**，
 * 靠的是**埋 + 压力 + 时间**，**不是盐** ✗。用户的要求是"配方要经得起考究" ✓，
 * 所以这里按"放进容器 + 等一天"来落地：材料对（鲨鱼本身 ✓）、时间有（一天 ✓ 对应埋数周的游戏化 ✓）。
 *
 * <h2>为什么不是"让木桶自己 tick"</h2>
 * ⚠ 打开真 jar（{@code neoforge-21.1.252-universal.jar}）查过：
 * {@code net/neoforged/neoforge/event/tick/} 下只有 Entity / Level / Player / Server 四种 tick，
 * **没有 {@code BlockEntityTickEvent}** ✗。而"每 tick 扫世界里所有方块实体"是这个仓库明令忌讳的
 * （见 {@code check-dish-effect-hooks} 的 {@code oresight-no-chunk-guard：会为了找矿强加载区块，卡服}）。
 *
 * <p>所以：右键木桶时记一条 {@code (维度, 坐标, 开始刻)} ✓，之后每 {@link #SCAN_INTERVAL} tick
 * **只遍历那份清单**（通常 0~几条）✓ —— **代价与"正在发酵的桶数"成正比，与世界大小无关** ✓。
 * 清单里没有东西时第一句就 return ✓（绝大多数 tick 是零开销 ✓）。
 */
@EventBusSubscriber(modid = AnglersTackle.MOD_ID)
public final class BarrelFermenting {

    /** 扫描间隔：每 20 tick（1 秒）看一次清单。发酵以"天"计（24000 tick），这个精度绰绰有余。 */
    private static final int SCAN_INTERVAL = 20;

    private BarrelFermenting() {
    }

    /**
     * 右键木桶 → 记进待发酵清单。
     *
     * <p>⚠ 这里**不能**要求"桶里已经有鱼"：玩家是**右键打开桶之后**才把鱼放进去的，
     * 所以第一次点击时桶往往是空的 ✗。记一条很便宜（O(1) ✓），
     * 真正"有没有可发酵的东西"由 {@link #onLevelTick} 那一侧判断 ✓ ——
     * 没有的话 20 tick 内就会把这条清掉 ✓，不会堆积。
     */
    @SubscribeEvent
    public static void onRightClickBarrel(PlayerInteractEvent.RightClickBlock event) {
        Level level = event.getLevel();
        if (level.isClientSide() || !(level instanceof ServerLevel serverLevel)) {
            return;
        }
        if (!(serverLevel.getBlockState(event.getPos()).getBlock() instanceof BarrelBlock)) {
            return;   // 只认**原版木桶**（用户口径），别的容器不管
        }
        FermentingData.get(serverLevel).remember(
                serverLevel.dimension(), event.getPos(), serverLevel.getGameTime());
    }

    /** 到点转化：只走清单，不扫世界。 */
    @SubscribeEvent
    public static void onLevelTick(LevelTickEvent.Post event) {
        if (!(event.getLevel() instanceof ServerLevel level)) {
            return;
        }
        // 先按间隔节流，再取清单 —— 顺序反了就等于每 tick 建一次快照 ✗
        if (level.getGameTime() % SCAN_INTERVAL != 0) {
            return;
        }
        FermentingData data = FermentingData.get(level);
        var pending = data.pending();
        if (pending.isEmpty()) {
            return;   // ★ 绝大多数 tick 走这一条：零开销（没有人在发酵）
        }
        long now = level.getGameTime();
        for (FermentingData.Entry e : pending.values()) {
            if (!e.dimension.equals(level.dimension())) {
                continue;   // 这一条属于别的维度，等那个维度 tick 时再处理
            }
            if (!level.isLoaded(e.pos)) {
                continue;   // 区块没加载 ⇒ **留着**（桶还在，只是没人看得到）✗ 不许当成"桶没了"
            }
            BlockEntity be = level.getBlockEntity(e.pos);
            if (!(be instanceof BarrelBlockEntity barrel)) {
                data.forget(e.key());   // 桶被挖了/换了 ⇒ 这条作废
                continue;
            }
            int slot = fermentableSlot(barrel);
            if (slot < 0) {
                data.forget(e.key());   // 鱼被拿走了（或者本来就没放）⇒ 作废
                continue;
            }
            if (now - e.startTick < FermentingData.DURATION_TICKS) {
                continue;               // 还没到一天
            }
            ItemStack out = ferment(barrel.getItem(slot));
            if (out.isEmpty()) {
                data.forget(e.key());
                continue;
            }
            barrel.setItem(slot, out);
            barrel.setChanged();
            data.forget(e.key());
        }
    }

    /** 桶里第一件**可发酵**的东西在第几格；没有就 -1。 */
    private static int fermentableSlot(BarrelBlockEntity barrel) {
        for (int i = 0; i < barrel.getContainerSize(); i++) {
            if (isFermentable(barrel.getItem(i))) {
                return i;
            }
        }
        return -1;
    }

    /**
     * 什么能发酵 —— **这张表是唯一真源**（要做别的发酵物就加在这里，别在别处再写一份）。
     *
     * <p>目前**只有格陵兰鲨** ✓：它是唯一一个"鲜食有毒、必须处理"的案例
     * （FishBase 记 "Poisonous to eat" ✓ 鲜肉含尿素 + TMAO ✓）。
     * ⚠ 别的鱼**不要**顺手加进来 ✗ —— 电鳗就不该在这儿：
     * [科普中国](https://cloud.kepuchina.cn/h5/detail?id=6974132020804194304) 明说它是
     * "原产地**著名的食用鱼**"✓，危险是**电击**不是毒性 ✗。
     */
    private static boolean isFermentable(ItemStack stack) {
        return !stack.isEmpty() && stack.is(ModItems.GREENLAND_SHARK.get());
    }

    /**
     * 发酵产物。
     *
     * <p>★ 用户口径："**成品直接出现替换该鱼，但鱼的数据不变**" ✓ ——
     * 所以整份组件**原样搬过去**（{@code FISH_DATA}：鱼种 / 重量 / 体长 / 档位 / 评级 全留着 ✓）。
     * 这样这块发酵鲨肉**还认得出是哪条鲨鱼** ✓，还能进菜品系统 ✓，
     * 而不是变成一件"和来历无关"的普通材料 ✗。
     */
    private static ItemStack ferment(ItemStack in) {
        ItemStack out = new ItemStack(ModItems.HAKARL.get(), in.getCount());
        out.applyComponents(in.getComponents());
        return out;
    }
}
