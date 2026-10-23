package com.whitecobalt.anglertackle.item;

import com.whitecobalt.anglertackle.fishing.Tuning;
import com.whitecobalt.anglertackle.registry.ModTags;
import net.minecraft.ChatFormatting;
import net.minecraft.core.BlockPos;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.TooltipFlag;
import net.minecraft.world.level.Level;

import java.util.List;

/**
 * 「渔夫小屋定位线索」—— 用一次，直接报出**离玩家最近的那座渔夫小屋的坐标**。
 *
 * <p>用户 2026-10-02 定案（原话）：
 * <blockquote>
 *   清楚罗盘物品，改为「渔夫小屋定位线索」，使用8张纸与一条mod鱼合成，
 *   使用后直接告诉距离玩家最近的小屋坐标。无论你怎么做，反正必须实现这种功能。
 *   我有一个参考想法，反正这玩意已经进结构了，那就借一下原版查找结构指令的原理，
 *   让玩家没权限也可以通过这个物品寻找。
 * </blockquote>
 *
 * <h2>做的正是"原版 /locate 的那套原理"</h2>
 * {@code ServerLevel.findNearestMapStructure} 就是 {@code /locate structure} 背后调用的那个方法：
 * 以玩家所在位置为圆心一圈一圈往外扩，把每一圈的区块推进到 {@code STRUCTURE_STARTS}
 * 阶段，问"这一圈里有没有这个结构"。它**不看玩家权限** —— 权限是命令自己的门槛，
 * 不是查找能力的门槛。所以这件物品天然"没 OP 也能用"，
 * 而且拿到的坐标与 {@code /locate} 的结果完全一致。
 *
 * <p>搜索半径走配置 {@code gameplay.compassSearchRadius}（单位：格，内部按 /16 换成区块）——
 * 这个键名是旧的（跟着已被删掉的追踪罗盘），但语义没变：就是"找多远"。
 *
 * <h2>和罗盘的区别</h2>
 * 罗盘是"一直指着"的常驻追踪器，需要服务端每两秒搜一次、把坐标推给客户端，
 * 还要一个自定义物品属性去转模型。线索是**一次性道具**：点一下、报一次坐标、
 * 消耗一张。小屋现在和村庄一样稀（spacing 34），玩家真正需要的是"知道在哪"，
 * 而不是"一直有个箭头"。
 */
public class HutClueItem extends Item {

    /** 用一次的冷却（tick），防止连点刷屏。 */
    private static final int COOLDOWN = 20;

    public HutClueItem(Properties properties) {
        super(properties);
    }

    /**
     * 物品说明：这件东西是**一次性道具**，玩家必须能从 tooltip 上直接看懂
     * "怎么来的、怎么用、用一次就没了"，否则只能翻手册第八章去找。
     *
     * <p>用户 2026-10-02："教程里没透露钓鱼小屋线索的制作方法。"
     * 当时 {@code item.anglertackle.hut_clue.desc} 与 {@code .cost} 两个语言键
     * **早就写好了却没人用**（没有 appendHoverText，键成了孤儿），
     * 手册里那页又埋在第八章末尾 —— 两头都没说出来。
     * 现在 tooltip 里三行齐了：做什么用、怎么合成、消耗规则。
     *
     * <p>⚠ 合成那一行是**文字**，不是从配方自动生成的：配方用的是
     * {@code #anglertackle:fishes} 标签，tooltip 里只能写成人话"任意模组鱼"。
     * 数字对不上由 {@code tools/check-hut-clue.js} 盯着（它会把手册、
     * 语言键与 recipe JSON 三边的"8 张纸 + 1 条鱼"逐一对账）。
     */
    @Override
    public void appendHoverText(ItemStack stack, Item.TooltipContext context,
                                List<Component> lines, TooltipFlag flag) {
        lines.add(Component.translatable("item.anglertackle.hut_clue.desc")
                .withStyle(ChatFormatting.GRAY));
        lines.add(Component.translatable("item.anglertackle.hut_clue.craft")
                .withStyle(ChatFormatting.DARK_GRAY));
        lines.add(Component.translatable("item.anglertackle.hut_clue.cost")
                .withStyle(ChatFormatting.DARK_GRAY));
    }

    @Override
    public InteractionResult use(Level level, Player player, InteractionHand hand) {
        ItemStack stack = player.getItemInHand(hand);
        if (level.isClientSide() || !(player instanceof ServerPlayer sp)) {
            // 客户端只回一个"用过了"的手势，真正的判定全在服务端
            return (level.isClientSide() ? InteractionResult.SUCCESS : InteractionResult.SUCCESS_SERVER).heldItemTransformedTo(stack);
        }

        ServerLevel serverLevel = sp.level();
        // ⚠ 配置只能在运行时读（注册期读会抛 "Cannot get config value before config is loaded."）。
        //   radius 的单位是**区块**，配置里写的是玩家看得懂的"格"，所以除以 16。
        int radiusChunks = Math.max(1, Tuning.compassSearchRadius() / 16);
        BlockPos target = serverLevel.findNearestMapStructure(
                ModTags.FISHERMAN_HUT, sp.blockPosition(), radiusChunks, false);

        if (target == null) {
            // 找不到**不消耗**：玩家会连着点好几次确认，扣掉了只会让人以为道具坏了
            sp.sendSystemMessage(Component.translatable("message.anglertackle.hut_clue_none",
                    Tuning.compassSearchRadius()).withStyle(ChatFormatting.YELLOW));
            return InteractionResult.SUCCESS.heldItemTransformedTo(stack);
        }

        // 水平直线距离（玩家关心的"还要跑多远"就是它，不算高度差）
        double dx = target.getX() - sp.getX();
        double dz = target.getZ() - sp.getZ();
        int distance = (int) Math.round(Math.sqrt(dx * dx + dz * dz));

        sp.sendSystemMessage(Component.translatable("message.anglertackle.hut_clue_found",
                target.getX(), target.getY(), target.getZ(), distance)
                .withStyle(ChatFormatting.AQUA));
        // 顺手给一句方位 —— 光有坐标还得自己算朝哪边走
        sp.sendSystemMessage(Component.translatable("message.anglertackle.hut_clue_dir",
                compassWord(dx, dz)).withStyle(ChatFormatting.GRAY));

        stack.shrink(1);   // 一次性道具：报完就没了（8 张纸 + 一条鱼换一条线索）
        sp.getCooldowns().addCooldown(this, COOLDOWN);
        com.whitecobalt.anglertackle.AnglersTackle.LOGGER.info(
                "[垂纶] 定位线索：{} 找到小屋 {}（{} 格，{}）",
                sp.getName().getString(), target.toShortString(), distance, compassWord(dx, dz));
        return InteractionResult.SUCCESS.heldItemTransformedTo(stack);
    }

    /** 目标在玩家的哪个方向（八个方位，和原版地图约定一致：北 = −Z）。 */
    private static String compassWord(double dx, double dz) {
        double angle = Math.toDegrees(Math.atan2(dx, -dz));   // 0 = 正北，顺时针为正
        String[] names = {"北", "东北", "东", "东南", "南", "西南", "西", "西北"};
        int idx = (int) Math.round(((angle % 360) + 360) % 360 / 45.0) % 8;
        return names[idx];
    }
}
