package com.whitecobalt.anglertackle.client.render;

import com.mojang.blaze3d.systems.RenderSystem;
import com.mojang.blaze3d.vertex.PoseStack;
import com.mojang.math.Axis;
import com.whitecobalt.anglertackle.item.RodItem;
import net.minecraft.client.Camera;
import net.minecraft.client.Minecraft;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.client.resources.model.BakedModel;
import net.minecraft.util.Mth;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.entity.HumanoidArm;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.item.ItemDisplayContext;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.phys.Vec3;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.client.event.RenderHandEvent;
import org.joml.Vector3f;
import org.joml.Vector4f;

/**
 * 竿尖的**真实**位置（鱼线的上端）。
 *
 * <h2>为什么需要这个类</h2>
 * 鱼线的上端必须落在"屏幕上那根竿的尖上"。竿是原版**手持渲染**画出来的，
 * 它经历了两步变换：
 * <ol>
 *   <li>{@code ItemInHandRenderer.renderArmWithItem} 里的**手持 / 使用动画**变换
 *       （我们右键蓄力时走的是 {@code UseAnim.BOW} 分支，竿会被拉开、转 45°）；</li>
 *   <li>物品**模型自己的显示变换**（{@code item/generated} 的
 *       {@code firstperson_righthand}：{@code rotation [0,−90,25]}、
 *       {@code translation [1.13,3.2,1.13]}、{@code scale 0.68}），
 *       之后还有一句 {@code translate(−0.5,−0.5,−0.5)} 把模型空间居中。</li>
 * </ol>
 *
 * <p>这两步都**不是**"眼睛前方 N 格"能估出来的 —— 之前就是估的，用户 2026-10-02
 * 截图反馈"鱼线实际上没有连接到杆子上"。照抄原版 {@code FishingHookRenderer}
 * 那个近平面锚点 {@code getPointOnPlane(±0.525, −0.1)} 也不行：那两个数是原版
 * 对着**它自己那根竿**（{@code item/handheld_rod} 变换 + 竿尖在贴图右上角）
 * 调出来的，我们的模型是 {@code item/generated}、竿尖在贴图**左上**角，
 * 于是线头仍然落在离竿尖大半个屏幕的地方。
 *
 * <h2>做法</h2>
 * 用 {@link RenderHandEvent}（由 {@code ClientHooks.renderSpecificFirstPersonHand}
 * 在 {@code renderArmWithItem} **之前**触发）。事件给的 PoseStack 已经在
 * **相机空间**里（只多两个视角摆动旋转），我们在它的副本上照抄上面两步变换，
 * 再把"竿尖在图标上的那个像素"换算成模型空间坐标乘进去 ——
 * 得到的就是原版真的画在屏幕上的那个点，与 FOV、视角、左右手、蓄力进度**全部自动一致**。
 *
 * <p>记下来的是**相机空间**坐标（+x 右 / +y 上 / −z 前），渲染鱼线时再用当帧相机
 * 的正交基换算回世界坐标（见 {@link #worldTip}）。手在相机空间里的位置与相机朝向无关，
 * 所以即使事件比鱼线渲染晚一帧触发也没有影响。
 */
@EventBusSubscriber(modid = com.whitecobalt.anglertackle.AnglersTackle.MOD_ID, value = Dist.CLIENT)
public final class RodTipAnchor {

    // ------------------------------------------------------------------ 竿尖在图标上的像素
    //
    // 约定：**最上面那一行不透明像素里最左那个像素的外角**（贴图左上角为原点）。
    // 两类竿的图标是两套画法（台钓竿是老式阶梯块，路亚竿是 45° 斜杆），尖端不在一起，
    // 所以分开写。tools/check-line-anchor.js 会**直接从 PNG 里重新量一遍**再和这里比对：
    // 改了图标却没改这两个数，检查就会红。
    /** 台钓竿图标（float_rod）的竿尖像素。 */
    // ★★ 2026-10-11 用户口径："**贴图别改，要改只能改鱼线位置，让每一把杆的鱼线显示有自己的位置**"
    //    ⇒ 竿尖从"两个常量（台钓一个、路亚一个）"改成**每把竿一个**。
    //    数值 = 那张贴图里**扫描序第一个不透明像素**（与 check-line-anchor.js 的 measureTip 同一定义），
    //    单位是 128×128 图标的像素（见 ICON_SIZE）。
    //
    // ⚠ 为什么非改成每把一把：新贴图里三张台钓的竿梢分别落在 (9,7) / (22,16) / (18,7) ——
    //   共用一个常量时，鱼线会挂歪其中两把 ✗。
    //   旧的那条"同族五种材质必须量出同一个尖"是**针对当年生成的那版图**的要求（生成器会把尖端画在同一处），
    //   适用范围只有旧图 —— 用户 2026-10-11 澄清："与现在的贴图没有任何关系"。
    private static final java.util.Map<String, double[]> TIP_BY_ITEM = java.util.Map.ofEntries(
            // ⚠ 2026-10-11：wood_float_rod 的贴图**换成了"钻石台钓改色"版**。
            //   原因（用户实测）：原来那张的来源是 1254 像素、缩到 128 等于 ÷9.8 ⇒ 游戏里
            //   "建模因为贴图原因很破碎" ✗。用户给的解法："拿钻石台钓的贴图简单更改颜色"
            //   —— 钻石台钓的来源本来就是 128，干净。改色只动"青/蓝绿"那一族（杆身），
            //   红浮漂与灰配件一个像素不动；改完逐像素核对过"不透明 1552 → 1552"（没抠空）。
            //   ⇒ 几何与钻石台钓相同 ⇒ 竿尖也是 (2,2)。
            java.util.Map.entry("wood_float_rod", new double[]{2.0, 2.0}),
            // ⚠ 2026-10-11：五把台钓**全部统一按"钻石台钓改色"**重制（用户口径：
            //   "台钓统一改色钻石，记住处理两种形态的贴图"）⇒ 几何完全一致 ⇒ 竿尖全是 (2,2)。
            //   （铁台钓原来是 (22,16)，因为它的原图取景与别人不同。）
            java.util.Map.entry("iron_float_rod", new double[]{2.0, 2.0}),
            java.util.Map.entry("gold_float_rod", new double[]{2.0, 2.0}),
            java.util.Map.entry("diamond_float_rod", new double[]{2.0, 2.0}),
            // ⚠ 2026-10-11：netherite_float_rod 也**换成改色版**了（同 wood_float_rod 那次）。
            //   用户实测"下界合金台钓竿也出现如此情况"（来源 1254 像素 ÷9.8 ⇒ 破碎 ✗）
            //   ⇒ 按同一套方法：拿**钻石台钓**（原生 128、干净）改色成下界合金暗灰紫
            //   （#141419 → #3b3b42 的亮度映射，红浮漂不动）；核对过"不透明 1552 → 1552"。
            //   几何与钻石台钓相同 ⇒ 竿尖 (2,2)。
            java.util.Map.entry("netherite_float_rod", new double[]{2.0, 2.0}),
            java.util.Map.entry("wood_lure_rod", new double[]{2.0, 2.0}),
            java.util.Map.entry("iron_lure_rod", new double[]{2.0, 2.0}),
            java.util.Map.entry("gold_lure_rod", new double[]{2.0, 2.0}),
            java.util.Map.entry("diamond_lure_rod", new double[]{2.0, 2.0}),
            java.util.Map.entry("netherite_lure_rod", new double[]{2.0, 2.0}));

    /** 取**这把竿**的竿尖像素；表里没有就退回按竿型的默认常量（未知竿不受影响）。 */
    public static double[] tipOf(ItemStack stack, RodItem rod) {
        String path = net.minecraft.core.registries.BuiltInRegistries.ITEM
                .getKey(stack.getItem()).getPath();
        double[] t = TIP_BY_ITEM.get(path);
        if (t != null) {
            return t;
        }
        return rod.rodType() == RodItem.RodType.FLOAT
                ? new double[]{FLOAT_TIP_PIXEL_X, FLOAT_TIP_PIXEL_Y}
                : new double[]{LURE_TIP_PIXEL_X, LURE_TIP_PIXEL_Y};
    }

    public static final double FLOAT_TIP_PIXEL_X = 9.0;
    public static final double FLOAT_TIP_PIXEL_Y = 7.0;
    /**
     * 路亚竿图标（lure_rod）的竿尖像素。
     *
     * <p>2026-10-02 两轮改动都动了这个点，所以它必须跟着图标走：
     * ① "杆子显得有点细，加粗到杆捎5像素左右" → 杆身 5/3/3 → 7/5/5，尖端 (6,6) → (7,5)；
     * ② "需要做一下竿尖，现在像是平的" → 最后 6% 杆长收尖，尖端又回到 **(6,6)**。
     * {@code check-line-anchor.js} 会从 PNG 里重量一遍；改图标不改这里就红。
     */
    public static final double LURE_TIP_PIXEL_X = 2.0;
    public static final double LURE_TIP_PIXEL_Y = 2.0;
    /** 贴图边长（我们的物品贴图都是 64×64，检查器会一并核对）。 */
    // ⚠ 2026-10-11：贴图边长从 **64 改成 128**（用户给了全新的一套竿贴图，口径是
    //   "**一切贴图以新为准，自己更改设置适应新贴图**"）。这个常量是像素→UV 的除数，
    //   改了图标边长就必须一起改，否则竿尖换算会整体错位。
    public static final double ICON_SIZE = 128.0;

    /**
     * 上一帧手持渲染记下的竿尖，**相机空间**坐标。
     * {@code null} = 还没渲染过第一人称的手（刚进世界、或第三人称）。
     */
    private static Vec3 viewSpaceTip;

    private RodTipAnchor() {
    }

    @SubscribeEvent
    public static void onRenderHand(RenderHandEvent event) {
        ItemStack stack = event.getItemStack();
        if (!(stack.getItem() instanceof RodItem rod)) {
            return;
        }
        Minecraft mc = Minecraft.getInstance();
        LocalPlayer player = mc.player;
        if (player == null) {
            return;
        }
        // 两只手都拿竿时以主手为准。主手先渲染、副手后渲染，所以这里必须显式跳过副手，
        // 否则后写的副手会把主手的竿尖覆盖掉 —— 线会挂到另一只手上的竿上去。
        // （与 FishingLineRenderer.rodHandSide() 的取舍保持一致。）
        if (event.getHand() == InteractionHand.OFF_HAND
                && player.getMainHandItem().getItem() instanceof RodItem) {
            return;
        }

        PoseStack ps = new PoseStack();
        // 从事件给的矩阵出发：它已经含"相机空间 + 视角摆动"那两个旋转
        ps.last().pose().set(event.getPoseStack().last().pose());

        boolean mainHand = event.getHand() == InteractionHand.MAIN_HAND;
        HumanoidArm arm = mainHand ? player.getMainArm() : player.getMainArm().getOpposite();
        boolean right = arm == HumanoidArm.RIGHT;

        // ================= 以下照抄 ItemInHandRenderer.renderArmWithItem（NeoForge 1.21.1）=================
        boolean using = player.isUsingItem() && player.getUseItemRemainingTicks() > 0
                && player.getUsedItemHand() == event.getHand();
        if (using) {
            applyItemArmTransform(ps, right, event.getEquipProgress());
            if (stack.getUseAnimation() == net.minecraft.world.item.UseAnim.BOW) {
                applyBowTransform(ps, right, stack, player, event.getPartialTick());
            }
        } else {
            float swing = event.getSwingProgress();
            float f = -0.4F * Mth.sin(Mth.sqrt(swing) * (float) Math.PI);
            float f1 = 0.2F * Mth.sin(Mth.sqrt(swing) * ((float) Math.PI * 2F));
            float f2 = -0.2F * Mth.sin(swing * (float) Math.PI);
            ps.translate((right ? 1 : -1) * f, f1, f2);
            applyItemArmTransform(ps, right, event.getEquipProgress());
            applyItemArmAttackTransform(ps, right, swing);
        }

        // 物品自己的显示变换 + 模型空间居中（对应原版 ItemRenderer.render 里的
        // ClientHooks.handleCameraTransforms(...) 与紧随其后的 translate(-0.5,-0.5,-0.5)）
        BakedModel model = mc.getItemRenderer().getModel(stack, mc.level, player, 0);
        model.applyTransform(
                right ? ItemDisplayContext.FIRST_PERSON_RIGHT_HAND : ItemDisplayContext.FIRST_PERSON_LEFT_HAND,
                ps, !right);
        ps.translate(-0.5F, -0.5F, -0.5F);

        // 竿尖：图标像素 → 贴图 UV → 物品模型空间 [0,1]³（v 轴向下，模型 y 轴向上，故 y = 1 − v）
        double[] tipPx = tipOf(stack, rod);
        double px = tipPx[0];
        double py = tipPx[1];
        Vector4f tip = new Vector4f(
                (float) (px / ICON_SIZE),
                (float) (1.0 - py / ICON_SIZE),
                0.5F,      // 扁平物品的厚度中心
                1.0F);
        tip.mul(ps.last().pose());

        // ★★ 这一步**绝对不能省**，也是 2026-10-02 用户报"端点不固定、摇视角反向跑、
        //    落到身体里"的真凶。原版 GameRenderer.renderItemInHand 是这么摆的：
        //
        //        PoseStack posestack = new PoseStack();
        //        posestack.mulPose(p_333953_.invert(new Matrix4f()));   // 手部 PoseStack 乘的是"相机旋转的**逆**"
        //        matrix4fstack.pushMatrix().mul(p_333953_);             // modelview 才是相机旋转
        //        RenderSystem.applyModelViewMatrix();
        //
        //    顶点最终按 `Projection × ModelView × PoseStack × v` 变换，所以事件里拿到的
        //    PoseStack **不是相机空间**，而是被相机反着转过的坐标系。只按它算出来的点：
        //    **到相机的距离对、方向反** —— 表现就是线头随视角反向乱跑、还常常落进玩家
        //    身体里（半径约 1 格）。乘回 modelview（这一刻正是相机旋转，手部渲染马上要
        //    用的就是它）才得到真正的相机空间坐标。
        tip.mul(RenderSystem.getModelViewMatrix());

        viewSpaceTip = new Vec3(tip.x(), tip.y(), tip.z());
        // ================= 照抄结束 =================
    }

    /** 原版 {@code applyItemArmTransform}：把手摆到画面右下角。 */
    private static void applyItemArmTransform(PoseStack ps, boolean right, float equipProgress) {
        ps.translate((right ? 1 : -1) * 0.56F, -0.52F + equipProgress * -0.6F, -0.72F);
    }

    /** 原版 {@code applyItemArmAttackTransform}：挥手（空挥）时手臂挥出去那一下。 */
    private static void applyItemArmAttackTransform(PoseStack ps, boolean right, float swing) {
        int i = right ? 1 : -1;
        float f = Mth.sin(swing * swing * (float) Math.PI);
        ps.mulPose(Axis.YP.rotationDegrees(i * (45.0F + f * -20.0F)));
        float f1 = Mth.sin(Mth.sqrt(swing) * (float) Math.PI);
        ps.mulPose(Axis.ZP.rotationDegrees(i * f1 * -20.0F));
        ps.mulPose(Axis.XP.rotationDegrees(f1 * -80.0F));
        ps.mulPose(Axis.YP.rotationDegrees(i * -45.0F));
    }

    /**
     * 原版 BOW 使用动画（我们右键蓄力时走这条）。
     *
     * <p>{@code f12} 是"拉开进度"：蓄力 20 tick 后到 1 并保持，所以持续持竿时竿的姿态是稳定的；
     * 前 20 tick 会逐渐拉开（竿尖位置也跟着动，这里逐帧照算，不需要额外处理）。
     */
    private static void applyBowTransform(PoseStack ps, boolean right, ItemStack stack,
                                          LivingEntity entity, float partialTick) {
        int k = right ? 1 : -1;
        ps.translate(k * -0.2785682F, 0.18344387F, 0.15731531F);
        ps.mulPose(Axis.XP.rotationDegrees(-13.935F));
        ps.mulPose(Axis.YP.rotationDegrees(k * 35.3F));
        ps.mulPose(Axis.ZP.rotationDegrees(k * -9.785F));
        float elapsed = (float) stack.getUseDuration(entity)
                - ((float) entity.getUseItemRemainingTicks() - partialTick + 1.0F);
        float f12 = elapsed / 20.0F;
        f12 = (f12 * f12 + f12 * 2.0F) / 3.0F;
        if (f12 > 1.0F) {
            f12 = 1.0F;
        }
        if (f12 > 0.1F) {
            float f15 = Mth.sin((elapsed - 0.1F) * 1.3F);
            float f18 = f12 - 0.1F;
            float f20 = f15 * f18;
            ps.translate(f20 * 0.0F, f20 * 0.004F, f20 * 0.0F);
        }
        ps.translate(f12 * 0.0F, f12 * 0.0F, f12 * 0.04F);
        ps.scale(1.0F, 1.0F, 1.0F + f12 * 0.2F);
        ps.mulPose(Axis.YN.rotationDegrees(k * 45.0F));
    }

    /**
     * 把记下的**相机空间**竿尖换算成世界坐标。
     *
     * <p>相机空间的原点是相机、{@code +x} 右、{@code +y} 上、{@code −z} 前，
     * 于是：世界 = 相机位置 − left·x + up·y − look·z。
     *
     * @return 世界坐标；还没记录到（第三人称、或这一帧之前没渲染过手）时返回 {@code null}，
     *         调用方应退回原版近平面锚点。
     */
    public static Vec3 worldTip(Camera camera) {
        Vec3 tip = viewSpaceTip;
        if (tip == null) {
            return null;
        }
        Vector3f left = camera.getLeftVector();
        Vector3f up = camera.getUpVector();
        Vector3f look = camera.getLookVector();
        Vec3 pos = camera.getPosition();
        return new Vec3(
                pos.x - left.x() * tip.x + up.x() * tip.y - look.x() * tip.z,
                pos.y - left.y() * tip.x + up.y() * tip.y - look.y() * tip.z,
                pos.z - left.z() * tip.x + up.z() * tip.y - look.z() * tip.z);
    }

    /** 退出世界 / 断线时清掉，避免下次进世界第一帧用到上一次的记录。 */
    public static void clear() {
        viewSpaceTip = null;
    }
}
