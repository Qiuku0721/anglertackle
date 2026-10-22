package com.whitecobalt.anglertackle.effect;

import net.minecraft.world.effect.MobEffect;
import net.minecraft.world.effect.MobEffectCategory;

/**
 * 菜型效果的**公共基类**（docs/28 的 11 项效果都用它）。
 *
 * <p>为什么要单独一个类：原版 {@code MobEffect(MobEffectCategory, int)} 的构造函数是
 * **protected** —— 不继承就没法 new（第一次编译就是这么红的：报"找到/需要"两行一模一样、
 * 只有一句"在 MobEffect 中是 protected 访问控制"）。
 *
 * <p>顺带也是后面加行为的地方：那些需要按等级生效的效果（如鱼得水 / 强力 / 海洋亲和…）
 * 都要在这里覆写 {@code applyEffectTick} / {@code addAttributeModifiers} 之类，
 * 或者由外部事件读取等级 —— 有一个自己的类就不用到处写匿名子类。
 */
public class DishMobEffect extends MobEffect {

    public DishMobEffect(MobEffectCategory category, int color) {
        super(category, color);
    }
}
