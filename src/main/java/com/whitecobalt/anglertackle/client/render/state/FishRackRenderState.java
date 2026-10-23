package com.whitecobalt.anglertackle.client.render.state;

import com.whitecobalt.anglertackle.fish.FishVariants;
import net.minecraft.client.model.geom.ModelLayerLocation;
import net.minecraft.client.renderer.blockentity.state.BlockEntityRenderState;
import net.minecraft.core.Direction;

/**
 * 鱼架的方块实体渲染状态。
 *
 * <p>旧 {@code FishRackRenderer.render(...)} 每帧从方块实体读方块状态、ItemStack、
 * 朝向，再查鱼种/缩放/抬高量。现在这些都在抽取阶段定下来，提交阶段只负责摆姿势。
 */
public class FishRackRenderState extends BlockEntityRenderState {
    /** 方块状态里的 HAS_FISH；没有鱼就什么都不提交。 */
    public boolean hasFish;
    /** 鱼种 id（贴图与模型层都按它取）。 */
    public String species = "";
    /** 该鱼种对应的模型层；为空说明这个物品不是本模组的鱼。 */
    public ModelLayerLocation layer;
    /** 尺寸档案（三轴缩放 + 中心偏移 + 长度反推的抬高量）。 */
    public FishVariants.Variant variant = FishVariants.of("");
    /** 方块朝向。 */
    public Direction facing = Direction.NORTH;
    /** 大鱼抬高量（格）：按体长超出 1 格的部分抬高，避免鱼身切进架子/地面。 */
    public float lift;
}
