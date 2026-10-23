package com.whitecobalt.anglertackle.client.render.state;

import net.minecraft.client.renderer.entity.state.LivingEntityRenderState;

/**
 * 通用鱼的渲染状态。
 *
 * <p>21 种鱼共用一个 {@code ModFishRenderer}，每个鱼种一个渲染器实例；
 * 贴图、缩放、阴影仍然按鱼种取，所以状态里要带鱼种 id。
 *
 * <p>{@code isInWater} / {@code ageInTicks} 等摆动与翻倒动画需要的字段
 * 由 {@link LivingEntityRenderState} 提供，{@code LivingEntityRenderer} 的
 * {@code extractRenderState} 已经填好。
 */
public class FishRenderState extends LivingEntityRenderState {
    /** 鱼种 id（对应 {@code FishVariants} / 贴图文件名）。 */
    public String species = "";
}
