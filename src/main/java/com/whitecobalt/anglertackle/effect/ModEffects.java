package com.whitecobalt.anglertackle.effect;

import com.whitecobalt.anglertackle.AnglersTackle;
import net.minecraft.core.registries.Registries;
import net.minecraft.world.effect.MobEffect;
// DishMobEffect：原版 MobEffect 的构造函数是 protected，必须有自己的子类
import net.minecraft.world.effect.MobEffectCategory;
import net.neoforged.neoforge.registries.DeferredHolder;
import net.neoforged.neoforge.registries.DeferredRegister;

/**
 * 菜型效果的**注册表**（策划见 docs/28-菜型效果策划.md，用户 2026-10-03 定案）。
 *
 * <p>11 项效果全部做成**原版药水效果**：右上角有图标、有倒计时、等级显示成 I/II/III…
 * —— 玩家吃一道菜之后能直接看见自己拿到了什么、还剩多久，不需要模组再画一套 UI。
 *
 * <p>图标是**自己画的像素图**（`assets/anglertackle/textures/mob_effect/<id>.png`，
 * 18×18，由 `tools/gen-effect-icons.js` 生成）：原版只按注册名找贴图，
 * 不画的话 HUD 上就是紫黑格。
 *
 * <p>⚠ 这里只注册"效果是什么、颜色是什么"；**给谁、几级、多久**在
 * {@link DishEffects}（吃菜的入口在 {@code DishItem}）。
 */
public final class ModEffects {

    private ModEffects() {
    }

    public static final DeferredRegister<MobEffect> EFFECTS =
            DeferredRegister.create(Registries.MOB_EFFECT, AnglersTackle.MOD_ID);

    // ------------------------------------------------------------------ 钓获类
    /** 渔运：钓获金红鱼的总爆率 +3 个百分点/级（绝对提升，金红平摊）。 */
    public static final DeferredHolder<MobEffect, MobEffect> FISHING_LUCK =
            EFFECTS.register("fishing_luck", () -> new DishMobEffect(MobEffectCategory.BENEFICIAL, 0xE8B33C));

    /** 爆口：抽鱼时 > 5 kg 的鱼总权重 +5%/级（与空军互斥）。 */
    public static final DeferredHolder<MobEffect, MobEffect> BIG_BITE =
            EFFECTS.register("big_bite", () -> new DishMobEffect(MobEffectCategory.BENEFICIAL, 0x8A4FD8));

    /** 空军：抽鱼时 ≤ 5 kg 的鱼总权重 +5%/级（与爆口互斥）。 */
    public static final DeferredHolder<MobEffect, MobEffect> SMALL_FRY =
            EFFECTS.register("small_fry", () -> new DishMobEffect(MobEffectCategory.BENEFICIAL, 0x6FC7E8));

    /** 巨物猎手：金品质以上的鱼上钩时，回拉速度 +20%/级。 */
    public static final DeferredHolder<MobEffect, MobEffect> GIANT_HUNTER =
            EFFECTS.register("giant_hunter", () -> new DishMobEffect(MobEffectCategory.BENEFICIAL, 0xA03030));

    // ------------------------------------------------------------------ 战斗 / 生存类
    /** 强力：远程武器伤害 +15%/级。 */
    public static final DeferredHolder<MobEffect, MobEffect> RANGED_POWER =
            EFFECTS.register("ranged_power", () -> new DishMobEffect(MobEffectCategory.BENEFICIAL, 0xD8483C));

    /** 风暴行者：下雨时攻击伤害 +20%、移动速度 +25%（每级）。 */
    public static final DeferredHolder<MobEffect, MobEffect> STORM_WALKER =
            EFFECTS.register("storm_walker", () -> new DishMobEffect(MobEffectCategory.BENEFICIAL, 0x3C5AA8));

    /** 干旱耐受：任何时候都享受下雨带来的加成。 */
    public static final DeferredHolder<MobEffect, MobEffect> DROUGHT_TOLERANCE =
            EFFECTS.register("drought_tolerance", () -> new DishMobEffect(MobEffectCategory.BENEFICIAL, 0xE08A2C));

    /** 如鱼得水：自然回血速度 +25%/级。 */
    public static final DeferredHolder<MobEffect, MobEffect> VITALITY =
            EFFECTS.register("vitality", () -> new DishMobEffect(MobEffectCategory.BENEFICIAL, 0x4CB05A));

    // ------------------------------------------------------------------ 水下类
    /** 海洋亲和：水下移动速度 +25%/级。 */
    public static final DeferredHolder<MobEffect, MobEffect> OCEAN_AFFINITY =
            EFFECTS.register("ocean_affinity", () -> new DishMobEffect(MobEffectCategory.BENEFICIAL, 0x2E7BC4));

    /** 两栖：持有本效果时忽略前置条件，强制让水下专属效果生效（深海探索者 / 潮涌能量）。 */
    public static final DeferredHolder<MobEffect, MobEffect> AMPHIBIOUS =
            EFFECTS.register("amphibious", () -> new DishMobEffect(MobEffectCategory.BENEFICIAL, 0x3FB6A8));

    /** 明目：用线条指引最近的矿物方块。 */
    public static final DeferredHolder<MobEffect, MobEffect> ORE_SIGHT =
            EFFECTS.register("ore_sight", () -> new DishMobEffect(MobEffectCategory.BENEFICIAL, 0xF0D040));
}
