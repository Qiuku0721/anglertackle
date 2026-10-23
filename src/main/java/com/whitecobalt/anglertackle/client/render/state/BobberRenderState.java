package com.whitecobalt.anglertackle.client.render.state;

import net.minecraft.client.renderer.entity.state.EntityRenderState;

/**
 * 浮漂实体在渲染帧里的快照。
 *
 * <p>26.1.2 把实体渲染拆成"抽状态 → 提交"：{@code render(BobberEntity, ...)} 里的所有
 * 取值都必须先在 {@code extractRenderState} 里搬进这个状态，{@code submit} 只读状态。
 * 这样渲染阶段不再直接碰实体（实体可能已经被服务端同步改过，甚至已经被移除）。
 */
public class BobberRenderState extends EntityRenderState {
    /** 水面上下浮动高度（{@code BobberEntity.getBob()}）。 */
    public float bob;
    /** 三段预告阶段：0 无 / 1 探饵 / 2 试探 / 3 吞钩。 */
    public byte bitePhase;
    /** 是否已经落水（飞行中要额外翻转）。 */
    public boolean landed;
    /**
     * 原始 tick 数（不带 partialTick）。
     *
     * <p>飞行中的翻转动画旧代码用的是 {@code entity.tickCount * 12°}，**不含 partialTick**；
     * {@link EntityRenderState#ageInTicks} 是 tickCount + partialTick，两者不能混用。
     */
    public int tickCount;
}
