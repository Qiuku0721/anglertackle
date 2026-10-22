package com.whitecobalt.anglertackle.block;

import net.minecraft.world.level.block.Block;

/**
 * 冰洞 —— 用凿冰镐在冰面上凿出来的洞（用户 2026-10-08 定案，docs/33 §8.1）。
 *
 * <h2>两条定案</h2>
 * <ol>
 *   <li><b>不会回冻</b> ✓ —— 所以这个类里**没有** {@code scheduleTick}、也没有 {@code tick}。
 *       它只会被凿冰镐再次右键砸成碎冰（见 {@code IcePickItem}）。
 *       ⚠ 以后谁想加"回冻"，先问用户：那是明确推翻过的设计。</li>
 *   <li><b>可抛投</b> ✓ —— 所以方块是 {@code noCollission}：浮漂要能停在这一格的水面上。</li>
 * </ol>
 *
 * <p>方块本身不带任何状态、也不需要方块实体：它是"冰面上的一格洞"，
 * 洞里的水是**下面那格真水**（原版水方块），我们只是把冰换成它。
 */
public class IceHoleBlock extends Block {

    public IceHoleBlock(Properties properties) {
        super(properties);
    }
}
