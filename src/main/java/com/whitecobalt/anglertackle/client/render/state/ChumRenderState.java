package com.whitecobalt.anglertackle.client.render.state;

import net.minecraft.client.renderer.entity.state.EntityRenderState;

/**
 * 打窝料实体的渲染状态。
 *
 * <p>旧 {@code ChumRenderer.render(...)} 每帧从实体读四项：上下浮动、是否落水、
 * 剩余寿命比例、tickCount（白圈闪烁用）。现在全部在抽取阶段取好。
 */
public class ChumRenderState extends EntityRenderState {
    /** 上下浮动高度（{@code ChumEntity.getBob()}）。 */
    public float bob;
    /** 是否已经落水。飞行中画翻滚的窝料团，落水后画小团 + 白圈。 */
    public boolean landed;
    /** 剩余寿命比例 0~1，< 0.2 时白圈闪烁。 */
    public float lifeRatio;
    /** 原始 tick 数（旧代码 {@code (entity.tickCount / 8) & 1} 决定闪烁相位）。 */
    public int tickCount;
}
