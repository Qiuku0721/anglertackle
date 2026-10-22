package com.whitecobalt.anglertackle.block;

import com.mojang.serialization.MapCodec;
import net.minecraft.world.item.DyeColor;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.block.state.StateDefinition;
import net.minecraft.world.level.block.state.properties.EnumProperty;

/**
 * 带坐垫的木板凳：皮革 + 木板凳 ✓ —— 坐上去比光板凳再多 1% 回拉速度 ✓。
 *
 * <p>用**子类**而不是给 {@code StoolBlock} 加一个 boolean 字段：原版的
 * {@code simpleCodec(StoolBlock::new)} 要求"只有一个 Properties 构造器" ✓，
 * 加字段就得自己写 Codec ✗；而子类天然有自己的 codec ✓、也天然能在
 * 方块注册表里是**另一个方块**（掉落、配方、名字都要分开 ✓）。
 */
public class CushionedStoolBlock extends StoolBlock {

    public static final MapCodec<CushionedStoolBlock> CODEC = simpleCodec(CushionedStoolBlock::new);

    /** 坐面颜色（16 种染料）。手里拿染色地毯右击即可换色，消耗一张地毯（用户 2026-10-09："消耗"）。 */
    public static final EnumProperty<DyeColor> COLOR = EnumProperty.create("color", DyeColor.class);

    public CushionedStoolBlock(Properties properties) {
        super(properties);
    }

    @Override
    protected MapCodec<? extends CushionedStoolBlock> codec() {
        return CODEC;
    }

    @Override
    protected void createBlockStateDefinition(StateDefinition.Builder<Block, BlockState> builder) {
        builder.add(COLOR, FACING);   // 颜色 + 朝向都要上报，否则状态不全 ⇒ 缺失模型 ✗   // ⚠ 少了这一行 ⇒ 方块没有 color 属性 ⇒ blockstate 的 16 个变体全匹配不上 ⇒ 缺失模型 ✗
    }
    @Override
    public double reelBonus() {
        return 0.02;          // 板凳 1% + 坐垫 1%
    }
}