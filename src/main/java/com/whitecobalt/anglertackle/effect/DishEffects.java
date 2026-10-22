package com.whitecobalt.anglertackle.effect;

import com.whitecobalt.anglertackle.fishing.FishChunkData;
import com.whitecobalt.anglertackle.recipe.DishRecipe;
import com.whitecobalt.anglertackle.registry.ModDataComponents;
import net.minecraft.core.Holder;
import net.minecraft.world.effect.MobEffect;
import net.minecraft.world.effect.MobEffectInstance;
import net.minecraft.world.effect.MobEffects;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.ItemStack;

import java.util.ArrayList;
import java.util.List;

/**
 * **吃菜给什么效果**（策划：docs/28-菜型效果策划.md，用户 2026-10-03 定案）。
 *
 * <h2>三条规则</h2>
 * <ol>
 *   <li><b>新效果只在顶级鱼（金 4 / 红 5）做的菜上生效</b>；普通/优质沿用旧效果
 *       （刺身给速度、清蒸给生命恢复、汤类给饱腹）。</li>
 *   <li><b>等级 = 鱼的档位</b>，再按该效果的"至高"封顶 —— 所以红档鱼做的
 *       海洋亲和是 V 级、金档是 IV 级；渔运至高 2，于是两个档位都给 II。</li>
 *   <li><b>时长</b>按材料档位给基准（普通 3:00 / 优质 5:00 / 顶级 8:00），
 *       每级 +2:00。旧效果是固定短时长（速度 20s、生命恢复 5s、饱腹 10s）。</li>
 * </ol>
 *
 * <h2>"同名菜只生效最高级"—— 用原版的，别自己写（用户提醒）</h2>
 * 用户 2026-10-03："关于互斥，原版就有相关代码" —— 指的是**等级与时长**这一段：
 * {@code LivingEntity#addEffect} → {@link MobEffectInstance#update} 已经写好了三种情形：
 * <ul>
 *   <li>新的等级**更高** → 直接顶替（等级与时长都换成新的）；</li>
 *   <li>等级**相同**、时间更长 → 只把时长延长；</li>
 *   <li>等级**更低**、时间更长 → **不动当前这份**，把低级那份存进
 *       {@code hiddenEffect}，等高级的到期后**自动恢复**。</li>
 * </ul>
 * 所以这里只调 {@code addEffect} 一件事 —— 自己比大小反而会丢掉 hiddenEffect 那层保险。
 *
 * <h2>两道菜互斥（爆口 × 空军）：原版没有对应机制，自己收口</h2>
 * 拿到其中一个就把另一个摘掉（否则两边都吃 = 双倍权重）。只在**这次真的给了这两个效果之一**时才动手。
 *
 * <h2>一道菜可以有多个效果</h2>
 * 顶级菜的"新效果"与"旧效果"**同时给**（用户："允许一道菜出现多个效果"）。
 */
public final class DishEffects {

    private DishEffects() {
    }

    /** 顶级（金/红）的判定：与 {@link FishChunkData#groupOfTier} 同一口径（≥4 档 = 顶级鱼排）。 */
    public static final int SUPREME_TIER = 4;

    /** 基准时长（tick）：普通 3:00 / 优质 5:00 / 顶级 8:00，每级 +2:00。 */
    static final int BASE_TICKS = 20 * 60 * 3;
    static final int PER_TIER_TICKS = 20 * 60;      // 每上一档 +1:00
    static final int PER_LEVEL_TICKS = 20 * 60 * 2; // 每升一级 +2:00

    /** 旧效果（普通/优质）的固定时长。 */
    static final int LEGACY_SPEED_TICKS = 20 * 20;      // 速度 20s
    static final int LEGACY_REGEN_TICKS = 20 * 5;       // 生命恢复 5s
    static final int LEGACY_SATURATION_TICKS = 20 * 10; // 饱腹 10s

    /** 一条"给什么效果"。 */
    public record Grant(Holder<MobEffect> effect, int level, int durationTicks) {
    }

    /**
     * 这道菜在这个档位下给出哪些效果。
     *
     * @param dishId 菜型 id（如 {@code sashimi}）
     * @param tier   鱼块/整鱼身上的真实档位 0…5
     */
    public static List<Grant> grantsFor(String dishId, int tier) {
        List<Grant> out = new ArrayList<>();
        int t = com.whitecobalt.anglertackle.fishing.FoodValues.clampTier(tier);
        boolean supreme = t >= SUPREME_TIER;

        // ---- 旧效果（普通/优质；顶级也保留，用户允许一道菜多个效果）----
        if (DishRecipe.Dish.SASHIMI.id().equals(dishId)) {
            if (supreme) {
                out.add(new Grant(MobEffects.MOVEMENT_SPEED, 2, 20 * 30));      // 速度 II 30s
                out.add(new Grant(MobEffects.WATER_BREATHING, 1, 20 * 30));     // 水下呼吸 30s
            } else if (t == 3) {
                out.add(new Grant(MobEffects.MOVEMENT_SPEED, 1, LEGACY_SPEED_TICKS));
            }
        } else if (DishRecipe.Dish.STEAMED.id().equals(dishId)) {
            out.add(new Grant(MobEffects.REGENERATION, 1, LEGACY_REGEN_TICKS));
        } else if (isSoup(dishId)) {
            out.add(new Grant(MobEffects.SATURATION, 1, LEGACY_SATURATION_TICKS));
        }

        // ---- 新效果：只在顶级鱼做的菜上生效 ----
        if (supreme) {
            Grant g = newEffectFor(dishId, t);
            if (g != null) {
                out.add(g);
            }
        }
        return out;
    }

    private static boolean isSoup(String dishId) {
        return DishRecipe.Dish.SOUP.id().equals(dishId)
                || DishRecipe.Dish.CREAMY.id().equals(dishId)
                || DishRecipe.Dish.STEW.id().equals(dishId);
    }

    /** 菜型 → 新效果（docs/28 §4 的映射表）。 */
    private static Grant newEffectFor(String dishId, int tier) {
        if (DishRecipe.Dish.SASHIMI.id().equals(dishId)) {
            return newGrant(ModEffects.OCEAN_AFFINITY, tier, 5);
        }
        if (DishRecipe.Dish.STEAMED.id().equals(dishId)) {
            return newGrant(ModEffects.VITALITY, tier, 3);
        }
        if (DishRecipe.Dish.SOUP.id().equals(dishId)) {
            return newGrant(ModEffects.DROUGHT_TOLERANCE, tier, 1);
        }
        if (DishRecipe.Dish.CREAMY.id().equals(dishId)) {
            return newGrant(ModEffects.AMPHIBIOUS, tier, 1);
        }
        if (DishRecipe.Dish.STEW.id().equals(dishId)) {
            return newGrant(ModEffects.STORM_WALKER, tier, 2);
        }
        if (DishRecipe.Dish.BRAISED.id().equals(dishId)) {
            return newGrant(ModEffects.FISHING_LUCK, tier, 2);
        }
        if (DishRecipe.Dish.PAN_FRIED.id().equals(dishId)) {
            return newGrant(ModEffects.RANGED_POWER, tier, 3);
        }
        if (DishRecipe.Dish.FRIED_CHUNK.id().equals(dishId)) {
            return newGrant(ModEffects.SMALL_FRY, tier, 3);
        }
        if (DishRecipe.Dish.BALL.id().equals(dishId)) {
            return newGrant(ModEffects.BIG_BITE, tier, 3);
        }
        if (DishRecipe.Dish.DEEP_FRIED.id().equals(dishId)) {
            return newGrant(ModEffects.GIANT_HUNTER, tier, 2);
        }
        if ("charred_fish".equals(dishId)) {
            return newGrant(ModEffects.ORE_SIGHT, tier, 1);
        }
        // 熏鱼不给新效果（保留"堆叠 64 的干粮"定位）
        return null;
    }

    /** 等级 = 鱼的档位，封顶到该效果的"至高"；时长 = 基准（按档位）+ 每级 2:00。 */
    private static Grant newGrant(Holder<MobEffect> effect, int tier, int maxLevel) {
        int level = Math.max(1, Math.min(maxLevel, tier));
        int duration = BASE_TICKS + PER_TIER_TICKS * (tier - 1) + PER_LEVEL_TICKS * (level - 1);
        return new Grant(effect, level, duration);
    }

    /**
     * 吃下一道菜：把效果给玩家。
     *
     * <p>等级/时长的取舍**全部交给原版**（见类注释：{@code MobEffectInstance#update}），
     * 这里只做一件事 —— 调 {@code addEffect}。
     */
    public static void apply(Player player, ItemStack stack) {
        if (!(stack.getItem() instanceof com.whitecobalt.anglertackle.item.DishItem dishItem)) {
            return;
        }
        FishChunkData data = stack.get(ModDataComponents.FISH_CHUNK.get());
        if (data == null) {
            return;                 // 创造模式/JEI 直拿的菜没有鱼数据 → 不给效果（说得通：不知是哪条鱼）
        }
        List<Grant> grants = grantsFor(dishItem.dishId(), data.tier());
        for (Grant g : grants) {
            // ⚠ 不要自己比等级/时长：原版 addEffect → MobEffectInstance#update 已经处理了
            //   "更高级顶替 / 同级延长 / 低级存成 hiddenEffect 等高级到期再恢复"这三种情形。
            player.addEffect(new MobEffectInstance(g.effect(), g.durationTicks(), g.level() - 1,
                    false, true, true));
        }
        // 爆口 × 空军互斥（原版没有这种机制，自己收口）：后拿到的顶掉先拿到的。
        // ⚠ 只在**这次真的给了这两个效果之一**时才动手，别去碰别的菜的效果。
        boolean gotBig = grants.stream().anyMatch((g) -> g.effect().equals(ModEffects.BIG_BITE));
        boolean gotSmall = grants.stream().anyMatch((g) -> g.effect().equals(ModEffects.SMALL_FRY));
        if (gotBig) {
            player.removeEffect(ModEffects.SMALL_FRY);
        }
        if (gotSmall) {
            player.removeEffect(ModEffects.BIG_BITE);
        }
    }
}
