package com.whitecobalt.anglertackle.recipe;

import com.whitecobalt.anglertackle.fishing.RodModManager;
import com.whitecobalt.anglertackle.item.RodItem;
import com.mojang.serialization.MapCodec;
import com.mojang.serialization.codecs.RecordCodecBuilder;
import net.minecraft.core.NonNullList;
import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.crafting.CraftingBookCategory;
import net.minecraft.world.item.crafting.CraftingInput;
import net.minecraft.world.item.crafting.CustomRecipe;
import net.minecraft.world.item.crafting.RecipeSerializer;
import net.minecraft.world.level.Level;

/**
 * 工作台 / 随身 2×2 合成栏装配件：**竿 + 一件配件 → 装好的那根竿**。
 *
 * <p>用户 2026-10-02："加一个工作台装配件和自身合成栏装配件功能。"
 *
 * <h2>为什么是 special 配方（匹配规则写在代码里）</h2>
 * 数据驱动的配方只能产出**固定的**物品栈，而这里要的是"把放进去的那根竿原样复制一份、
 * 装上配件再还给你"——耐久、已有配件、附魔、自定义名全都得跟着走。
 * 原版同类需求（染色盔甲、复制地图、修复物品）用的就是 {@link CustomRecipe} 这条路，
 * 所以这里照抄：JSON 里只写一个 {@code type}，匹配与产出在这里。
 *
 * <h2>为什么"工作台"和"随身 2×2"是同一个配方</h2>
 * 两个界面查配方的代码是同一句 {@code getRecipeFor(RecipeType.CRAFTING, …)}
 * （{@code CraftingMenu} 与 {@code InventoryMenu}），只要这条配方报告自己是
 * {@link net.minecraft.world.item.crafting.RecipeType#CRAFTING}（{@code CraftingRecipe}
 * 的默认实现），两处就**同时**生效。{@link #plan} 只按格子扫材料、不要求 3×3，
 * 所以随身 2×2 合成栏放得下（26.1.2 已删除 {@code canCraftInDimensions}）。
 *
 * <h2>只认正好两格</h2>
 * 一格竿、一格配件。多放任何东西都不匹配 —— 因为原版取走产出物时会从
 * **每一个非空格子**各扣 1 个（{@code ResultSlot#onTake}），多放的东西会被白白吃掉。
 *
 * <h2>换下来的旧配件退回格子里</h2>
 * 同一槽位原本有配件时，它会被替换掉。被替换的那一件通过
 * {@link #getRemainingItems} 放回**竿原来那一格**（原版的"合成剩余物"机制，
 * 和桶装水留下空桶是同一件事），带着它自己用过的耐久，不会被吞。
 */
public class RodAssemblyRecipe extends CustomRecipe {

    /** JSON 只有 {@code type + category}（与旧版 SimpleCraftingRecipeSerializer 的格式一致）。 */
    public static final MapCodec<RodAssemblyRecipe> MAP_CODEC = RecordCodecBuilder.mapCodec(
            i -> i.group(
                    CraftingBookCategory.CODEC
                            .optionalFieldOf("category", CraftingBookCategory.MISC)
                            .forGetter(RodAssemblyRecipe::category))
                    .apply(i, RodAssemblyRecipe::new));

    public static final StreamCodec<RegistryFriendlyByteBuf, RodAssemblyRecipe> STREAM_CODEC =
            CraftingBookCategory.STREAM_CODEC.<RegistryFriendlyByteBuf>cast()
                    .map(RodAssemblyRecipe::new, RodAssemblyRecipe::category);

    public static final RecipeSerializer<RodAssemblyRecipe> SERIALIZER =
            new RecipeSerializer<>(MAP_CODEC, STREAM_CODEC);

    private final CraftingBookCategory category;

    public RodAssemblyRecipe(CraftingBookCategory category) {
        this.category = category;
    }

    @Override
    public CraftingBookCategory category() {
        return category;
    }

    /** 一次装配的配料表：哪根竿、哪件配件、装到哪个槽、竿在第几格。 */
    private record Plan(ItemStack rod, RodItem rodItem, ItemStack part, int slot, int rodIndex) {
    }

    /**
     * 读出这次网格里的装配方案；不成立返回 {@code null}。
     *
     * <p>不成立的情形：不是正好两格、两根竿、两件配件、竿型/槽位对不上。
     */
    private static Plan plan(CraftingInput input) {
        ItemStack rod = ItemStack.EMPTY;
        ItemStack part = ItemStack.EMPTY;
        RodItem rodItem = null;
        int rodAt = -1;

        for (int i = 0; i < input.size(); i++) {
            ItemStack s = input.getItem(i);
            if (s.isEmpty()) {
                continue;
            }
            if (s.getItem() instanceof RodItem ri) {
                if (!rod.isEmpty()) {
                    return null;   // 两根竿：不猜哪根是底子
                }
                rod = s;
                rodItem = ri;
                rodAt = i;
            } else {
                if (!part.isEmpty()) {
                    return null;   // 两件配件：一次一件，不猜顺序（也保证不会有第三格被吃掉）
                }
                part = s;
            }
        }
        if (rod.isEmpty() || part.isEmpty()) {
            return null;
        }
        // 这件配件装得到这根竿上吗（台钓/路亚的槽位规则、鱼饵与拟饵的区别都在里面）
        int slot = RodModManager.partSlotOf(part, rodItem.rodType());
        if (slot < 0) {
            return null;
        }
        return new Plan(rod, rodItem, part, slot, rodAt);
    }

    @Override
    public boolean matches(CraftingInput input, Level level) {
        return plan(input) != null;
    }

    @Override
    public ItemStack assemble(CraftingInput input) {
        Plan plan = plan(input);
        if (plan == null) {
            return ItemStack.EMPTY;
        }
        // 复制**放进去的那一根**：耐久、已有配件、附魔、名字全都跟着走
        ItemStack out = plan.rod.copy();
        if (!RodModManager.applyPart(out, plan.rodItem.rodType(), plan.part)) {
            return ItemStack.EMPTY;
        }
        return out;
    }

    /**
     * 合成剩余物：被替换下来的旧配件放回竿原来那一格。
     *
     * <p>⚠ 用 {@link RodModManager#partAt}（竿上**存着**的那一份），不是按 id 重造 ——
     * 重造的耐久是满的，换一次件就把磨损洗掉了（用户 2026-10-02 报过这个）。
     */
    @Override
    public NonNullList<ItemStack> getRemainingItems(CraftingInput input) {
        NonNullList<ItemStack> out = NonNullList.withSize(input.size(), ItemStack.EMPTY);
        Plan plan = plan(input);
        if (plan == null) {
            return out;
        }
        ItemStack old = RodModManager.partAt(plan.rod, plan.slot).copy();
        if (!old.isEmpty()) {
            out.set(plan.rodIndex, old);
        }
        return out;
    }

    @Override
    public RecipeSerializer<RodAssemblyRecipe> getSerializer() {
        return SERIALIZER;
    }

    // ⚠ 刻意**不**覆盖 getType()：CraftingRecipe 的默认实现返回 RecipeType.CRAFTING，
    //   而两个合成栏正是拿它去查配方的。换成自己的类型 = 配方永远查不到，且没有任何报错。
}
