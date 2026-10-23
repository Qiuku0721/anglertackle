package com.whitecobalt.anglertackle.client.render;

import com.mojang.blaze3d.vertex.PoseStack;
import com.mojang.math.Axis;
import com.whitecobalt.anglertackle.AnglersTackle;
import com.whitecobalt.anglertackle.block.FishRackBlock;
import com.whitecobalt.anglertackle.block.FishRackBlockEntity;
import com.whitecobalt.anglertackle.client.model.ModFishModel;
import com.whitecobalt.anglertackle.client.render.state.FishRackRenderState;
import com.whitecobalt.anglertackle.fish.FishVariants;
import com.whitecobalt.anglertackle.registry.ModModelLayers;
import net.minecraft.client.model.geom.EntityModelSet;
import net.minecraft.client.model.geom.ModelLayerLocation;
import net.minecraft.client.renderer.SubmitNodeCollector;
import net.minecraft.client.renderer.blockentity.BlockEntityRenderer;
import net.minecraft.client.renderer.blockentity.BlockEntityRendererProvider;
import net.minecraft.client.renderer.feature.ModelFeatureRenderer;
import net.minecraft.client.renderer.rendertype.RenderTypes;
import net.minecraft.client.renderer.state.level.CameraRenderState;
import net.minecraft.client.renderer.texture.OverlayTexture;
import net.minecraft.core.Direction;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.resources.Identifier;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.phys.Vec3;
import org.jspecify.annotations.Nullable;

/**
 * 鱼架渲染器 —— 照抄原版 {@code SkullBlockRenderer} 的思路：
 * <b>方块实体渲染器直接 bakeLayer 复用实体模型</b>，不另做一套。
 *
 * <p>所以鱼架上摆的就是钓上来的那条鱼的**真模型**（形状、贴图、大小全对），
 * 只是不调 {@code setupAnim}，摆成静止姿势 —— 标本本来就该是静的。
 *
 * <p>鱼的贴图路径与实体渲染器一致：{@code textures/entity/fish/<鱼种>.png}。
 *
 * <p><b>26.1.2 迁移</b>：旧 {@code render(T, partial, PoseStack, MultiBufferSource, light, overlay)}
 * 改成 {@code createRenderState / extractRenderState / submit}。方块实体状态里带上
 * 鱼种、模型层、尺寸档案、朝向与抬高量；提交阶段只摆姿势并
 * {@code submitModelPart}。旧 {@code overlay} 参数在新接口里没有对应输入
 * （状态只有 lightCoords），这里用 {@link OverlayTexture#NO_OVERLAY} —— 方块实体
 * 原版调用方传的也是 NO_OVERLAY，视觉一致。
 */
public class FishRackRenderer implements BlockEntityRenderer<FishRackBlockEntity, FishRackRenderState> {

    /**
     * ⚠ **不要**在构造器里去取 Minecraft.getInstance().getEntityModels()：
     *   渲染器是在 RegisterRenderers 阶段构造的，那时 entityModels 还没随资源加载建好，
     *   拿到的是 null；等到真正渲染时 bakeLayer 抛异常，被 MC 吞掉，
     *   表现就是**方块在、鱼不显示**，日志里也不显眼。懒取即可。
     */
    /** 注册时需要一个 (Context) -> Renderer 的工厂，ctx 故意不用（见 models()）。 */
    public FishRackRenderer(BlockEntityRendererProvider.Context ctx) {
        // 什么都不做
    }

    private EntityModelSet models() {
        return net.minecraft.client.Minecraft.getInstance().getEntityModels();
    }

    @Override
    public FishRackRenderState createRenderState() {
        return new FishRackRenderState();
    }

    @Override
    public void extractRenderState(FishRackBlockEntity rack, FishRackRenderState state, float partialTick,
                                   Vec3 cameraPosition, ModelFeatureRenderer.@Nullable CrumblingOverlay breakProgress) {
        BlockEntityRenderer.super.extractRenderState(rack, state, partialTick, cameraPosition, breakProgress);

        // 先查方块状态：它一定会同步到客户端，是"拿下来之后模型还留着"的兜底。
        state.hasFish = rack.getBlockState().getValue(FishRackBlock.HAS_FISH);
        state.facing = rack.getBlockState().getValue(FishRackBlock.FACING);
        if (!state.hasFish) {
            return;
        }
        ItemStack fish = rack.fish();
        if (fish.isEmpty()) {
            return;
        }
        String species = BuiltInRegistries.ITEM.getKey(fish.getItem()).getPath();
        ModelLayerLocation layer = ModModelLayers.FISH.get(species);
        if (layer == null) {
            return;
        }
        FishVariants.Variant variant = FishVariants.of(species);

        // —— 大鱼：**不缩小**，按超出量抬高，避免鱼身切进架子/地面 ——
        // 用户原话："大鱼的优化指的是大小不变，调高度避免穿模"。
        // 鱼长从 hitW 反推：hitW = 长度(单位)/16 × 0.8。
        float lenBlocks = variant.hitW() / 0.8F;
        float lift = Math.max(0.0F, lenBlocks - 1.0F) * 1.1F;   // 大鱼抬得更高，不然贴着地

        state.species = species;
        state.layer = layer;
        state.variant = variant;
        state.lift = lift;
    }

    @Override
    public void submit(FishRackRenderState state, PoseStack pose, SubmitNodeCollector submitNodeCollector,
                       CameraRenderState camera) {
        if (!state.hasFish || state.layer == null) {
            return;
        }

        pose.pushPose();
        // ⚠ 必须**完整照搬 LivingEntityRenderer 的变换链**，少一步就是"颠倒 + 转 90°"：
        //   1. 鱼模型的坐标是**实体模型空间**：y 向下（24 = 地面）、面朝 -Z。
        //      实体渲染器靠 scale(-1,-1,1) 把它翻回正常朝向 —— 方块实体渲染器没有这一步，
        //      不自己加就是**上下颠倒**。
        //   2. 朝向要用原版的 180 - facing.toYRot()；手写 0/90/180/270 的映射会把东西向弄反。
        //   3. 变换顺序是**后调用的先作用**：最后那句 scale(sx,sy,sz) 最先作用于顶点。
        // 架子本体是沿 X 的长条，而鱼的长轴默认沿 Z —— 正好垂直，再转 90° 才平行。
        // 台面在 y = 2/16 = 0.125（木板只有 2 像素厚）——
        // 之前放在"方块顶面 1.0"上，高了近 0.88 格（用户："高度不对"）。
        pose.translate(0.5D, 0.125D + state.lift, 0.5D);
        Direction facing = state.facing;
        pose.mulPose(Axis.YP.rotationDegrees(180.0F - facing.toYRot() + 90.0F));
        pose.scale(-1.0F, -1.0F, 1.0F);                         // 进实体模型空间
        pose.translate(0.0D, -1.501D, 0.0D);                    // 把 y=24 的腹面挪到原点
        // 模型 z 原点在头身交界，不在鱼的中心 —— 补这个偏移才是居中
        pose.translate(0.0D, 0.0D, -state.variant.centerZ() / 16.0D);
        pose.scale(state.variant.sx(), state.variant.sy(), state.variant.sz());

        ModFishModel model = new ModFishModel(this.models().bakeLayer(state.layer), state.species);
        Identifier tex = Identifier.fromNamespaceAndPath(AnglersTackle.MOD_ID,
                "textures/entity/fish/" + state.species + ".png");
        // 旧代码是 model.root().render(pose, buffer.getBuffer(entityCutoutNoCull(tex)), light, overlay)；
        // 26.1.2 的 entityCutout 就是非 cull 版本，submitModelPart 与 root().render 等价。
        submitNodeCollector.submitModelPart(model.root(), pose, RenderTypes.entityCutout(tex),
                state.lightCoords, OverlayTexture.NO_OVERLAY, null);

        pose.popPose();
    }
}
