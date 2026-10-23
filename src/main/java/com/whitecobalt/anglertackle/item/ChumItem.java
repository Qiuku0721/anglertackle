package com.whitecobalt.anglertackle.item;

import com.whitecobalt.anglertackle.fishing.ChumManager;
import net.minecraft.ChatFormatting;
import net.minecraft.core.BlockPos;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.sounds.SoundSource;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.TooltipFlag;
import net.minecraft.world.level.Level;

import java.util.List;

/**
 * 窝料（打窝用）。
 *
 * <p>按 docs/02-钓鱼小游戏机制.md §7.2 的设计：
 * <ul>
 *   <li><b>水面窝</b>（普通三种）：撒下去在水面横向散开，影响表层/中上层鱼</li>
 *   <li><b>沉底窝</b>（秘制配方）：边下沉边散开，能影响底层鱼</li>
 *   <li>效果是**10 分钟增益**（不是 60 秒区域），只在同一片水域生效</li>
 *   <li>同类不叠加，只取最高品质下限</li>
 * </ul>
 *
 * <p>用法：对着水面右键撒窝。
 */
public class ChumItem extends Item {

    private final int tier;
    private final boolean sinking;
    private final int durationMinutes;
    private final double timeMultiplier;
    private final int coinValue;

    public ChumItem(int tier, boolean sinking, int durationMinutes, double timeMultiplier,
                    int coinValue, Properties properties) {
        super(properties);
        this.tier = tier;
        this.sinking = sinking;
        this.durationMinutes = durationMinutes;
        this.timeMultiplier = timeMultiplier;
        this.coinValue = coinValue;
    }

    public int tier() {
        return tier;
    }

    public boolean sinking() {
        return sinking;
    }

    public int durationMinutes() {
        return durationMinutes;
    }

    public double timeMultiplier() {
        return timeMultiplier;
    }

    /**
     * 窝子的**稀有度**倍率（金+红鱼种的目标占比乘这个数）。
     *
     * <h2>⚠ 这里曾经接过 {@link #timeMultiplier()}</h2>
     * 结果是玩家反馈"打窝影响不明显"——查日志发现倍率是 **0.45**：
     * <pre>
     *   浮漂进入窝子：距离 4.54 格（半径 10.0），档位 3，倍率 x0.45
     *   打窝加成：倍率 x0.45 → 金红占比 1.4%
     * </pre>
     * {@code timeMultiplier} 是**等待时间**倍率（越小咬得越快，
     * 0.75/0.65/0.55/0.45 是"越高级咬得越快"的阶梯）。拿它乘占比，
     * 等于**越好的窝越不出好鱼** —— 而 0.45 那个最贵的秘制窝
     * 恰恰把金红砍掉一半以上。这不是"不明显"，是**反效果**。
     *
     * <p>两个倍率是独立的两件事，必须各用各的字段：
     * <ul>
     *   <li>{@link #timeMultiplier()}：缩咬钩等待（越小越快）</li>
     *   <li>{@link #rarityMultiplier()}：抬稀有度（越大越好，**恒 ≥ 1**）</li>
     * </ul>
     *
     * <p>取值用设计文档给的水面窝阶梯 1.5 / 2.0 / 2.5，秘制（沉底）再高一档。
     * 恒 ≥ 1 是有意的：窝子只该让鱼更好，任何情况下都不该比不打窝差 ——
     * "花钱买了个负效果"是玩家会立刻察觉的那种问题。
     */
    public double rarityMultiplier() {
        return switch (tier) {
            case 0 -> 1.5;   // 通用谷物
            case 1 -> 2.0;   // 腥味肉
            case 2 -> 2.5;   // 甜香果
            default -> 3.5;  // 秘制配方（沉底，最贵）
        };
    }

    public int coinValue() {
        return coinValue;
    }

    @Override
    public InteractionResult use(Level level, Player player, InteractionHand hand) {
        ItemStack stack = player.getItemInHand(hand);
        // 客户端也要返回 consume，否则客户端不会播放挥手动作、也不预测扣物品
        if (level.isClientSide()) {
            return InteractionResult.CONSUME.heldItemTransformedTo(stack);
        }
        if (!(player instanceof ServerPlayer serverPlayer) || !(level instanceof ServerLevel serverLevel)) {
            return InteractionResult.PASS;
        }

        // ★ 抛出实体，不再"传送到水面"。
        //   玩家反馈"打窝前后不知道有没有效果、视觉上不直观"——
        //   原来的实现是直接算出水面坐标然后把窝子记在那里，
        //   没有飞行过程、水面也没有持久可见的标记，玩家根本不知道打到了哪。
        //   现在像鸡蛋一样飞出去，落水后自己冒泡 + 画白圈。
        com.whitecobalt.anglertackle.entity.ChumEntity chum =
                new com.whitecobalt.anglertackle.entity.ChumEntity(
                        com.whitecobalt.anglertackle.registry.ModEntities.CHUM.get(), serverLevel);

        // ★★ 全服名额（用户 2026-10-11 定案："全服至多存在 40 个窝料"）。
        //   必须**先占名额再生成实体**：反过来的话，水面上会先冒出一条窝子再被撤回，
        //   而"到底打出去了没有"在客户端是预测过的（那一帧已经扣了物品）。
        //   名额的到期时刻与实体寿命**用同一个数**（ChumEntity.lifeTicksOf）——
        //   各写一份就会漂移成"窝子还在、名额已放"（上限漏 ✗）或反之（打不出窝 ✗）。
        long now = serverLevel.getGameTime();
        long expireAt = now + com.whitecobalt.anglertackle.entity.ChumEntity.lifeTicksOf(this);
        if (!com.whitecobalt.anglertackle.fishing.ChumRegistry.get(serverLevel)
                .reserve(chum.getUUID(), now, expireAt)) {
            // 满员：不生成、不扣物品、不摆臂 —— 玩家手里那一叠窝料还在
            player.displayClientMessage(Component.translatable("message.anglertackle.chum_cap",
                    com.whitecobalt.anglertackle.fishing.ChumRegistry.cap()), true);
            return InteractionResult.FAIL;
        }

        chum.throwBy(serverPlayer, this);
        serverLevel.addFreshEntity(chum);

        // 抛出音效（在手边响，不是落点）
        serverLevel.playSound(null, player.blockPosition(), SoundEvents.SNOWBALL_THROW,
                SoundSource.NEUTRAL, 0.5f, 1.2f);
        // 摆臂动作（让第三人称看起来是"扔出去"）
        player.swing(hand, true);

        stack.shrink(1);
        player.displayClientMessage(Component.translatable("message.anglertackle.chum_thrown",
                player.getMainHandItem().getHoverName()), true);

        // 称号「打窝老手」：只有**真的打出去**（名额占到了、实体生成了）才计数 ——
        // 满员返回 fail 那一条路不算（窝子根本没落地，计数就是虚的 ✗）。
        try {
            com.whitecobalt.anglertackle.title.Titles.bump(serverPlayer,
                    com.whitecobalt.anglertackle.title.Titles.K_CHUM, 1);
            com.whitecobalt.anglertackle.title.Titles.syncAuto(serverPlayer);
        } catch (Throwable t) {
            com.whitecobalt.anglertackle.AnglersTackle.LOGGER
                    .warn("[垂纶] 打窝计数失败（已忽略）：{}", t.toString());
        }
        return InteractionResult.CONSUME.heldItemTransformedTo(stack);
    }

    @Override
    public void appendHoverText(ItemStack stack, Item.TooltipContext context,
                                List<Component> lines, TooltipFlag flag) {
        lines.add(Component.translatable(sinking
                        ? "tooltip.anglertackle.chum_sinking"
                        : "tooltip.anglertackle.chum_floating")
                .withStyle(sinking ? ChatFormatting.LIGHT_PURPLE : ChatFormatting.AQUA));
        // 档位名与颜色都走 Quality（与鱼/鱼块/配件同一套）——
        // 这里原来自己写了一张 tierName/tierColor 表，等于把"哪一档是哪个颜色"
        // 抄了第二份（2026-10-03 自查"该显示颜色的文本却是白色"时合并掉）
        lines.add(Component.translatable("tooltip.anglertackle.chum_floor."
                + Quality.of(tier).key()).withStyle(Quality.of(tier).color()));
        lines.add(Component.translatable("tooltip.anglertackle.chum_time",
                String.format("x%.2f", timeMultiplier)).withStyle(ChatFormatting.GREEN));
        lines.add(Component.translatable("tooltip.anglertackle.chum_duration", durationMinutes)
                .withStyle(ChatFormatting.GRAY));
        lines.add(Component.translatable("tooltip.anglertackle.chum_same_water")
                .withStyle(ChatFormatting.DARK_GRAY));
        // ⚠ 这里曾经有一行「参考价：X 鱼币」（tooltip.anglertackle.bait_price），
        //   与 BaitItem 同源，一起删掉：那是定价还写在物品定义里时的遗留，
        //   现在价格由 ShopCatalog 统一给出，tooltip 里的旧数字只会和"价值"打架。
    }
}
