package com.whitecobalt.anglertackle.util;

import net.minecraft.nbt.CompoundTag;
import net.minecraft.nbt.ListTag;
import net.minecraft.nbt.Tag;

/**
 * NBT 读取辅助（26.1.2 机械对齐用）。
 *
 * <p>26.1.2 的 {@link ListTag} **不再记录元素类型**（{@code getId()} 恒为 {@code 9} = TAG_LIST），
 * 所以旧版 {@code CompoundTag.getList(name, type)} 里"存的元素类型不符 ⇒ 返回空表"这一层过滤
 * 必须在这里补回来：读档时若表里出现非预期类型的元素，就当这张表不存在。
 * 元素类型全部相符时行为与 {@code getListOrEmpty(name)} 完全相同（空表两种写法都返回空表）。
 *
 * <p>为什么不能用 {@code list.getId()} 判断：那是 **ListTag 自身**的类型 id（恒为 9），
 * 不是元素的类型 id；要用 {@code element.getId()}。
 */
public final class NbtCompat {
    private NbtCompat() {
    }

    /** 等价于旧版 {@code tag.getList(key, elementType)}（元素类型不符 ⇒ 空表）。 */
    public static ListTag listOf(CompoundTag tag, String key, byte elementType) {
        ListTag list = tag.getListOrEmpty(key);
        for (Tag element : list) {
            if (element.getId() != elementType) {
                return new ListTag();
            }
        }
        return list;
    }
}
