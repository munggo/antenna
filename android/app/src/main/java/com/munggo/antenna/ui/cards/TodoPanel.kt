package com.munggo.antenna.ui.cards

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.outlined.Checklist
import androidx.compose.material.icons.outlined.KeyboardArrowDown
import androidx.compose.material.icons.outlined.KeyboardArrowUp
import androidx.compose.material.icons.outlined.RadioButtonUnchecked
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.munggo.antenna.model.TodoItem
import com.munggo.antenna.tr
import com.munggo.antenna.ui.Typo
import com.munggo.antenna.ui.colors
import com.munggo.antenna.ui.minus

/** 입력창 위 할 일 칸: 접히면 '할 일 2/5 · 지금: …' 한 줄, 누르면 목록 */
@Composable
fun TodoPanel(todos: List<TodoItem>, modifier: Modifier = Modifier) {
    var open by remember { mutableStateOf(false) }
    val done = todos.count { it.status == "completed" }
    val current = todos.firstOrNull { it.status == "in_progress" }
    val textSize = Typo.row - 1.sp

    Column(
        modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(colors.surfaceHigh)
            .padding(horizontal = 12.dp, vertical = 9.dp),
    ) {
        Row(
            Modifier
                .fillMaxWidth()
                .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) { open = !open },
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(Icons.Outlined.Checklist, contentDescription = null, tint = colors.accent, modifier = Modifier.size(16.dp))
            Text(
                tr("할 일 $done/${todos.size}", "To-dos $done/${todos.size}"),
                fontSize = textSize, fontWeight = FontWeight.SemiBold, color = colors.text, maxLines = 1,
            )
            if (current != null) {
                Text(
                    "· ${current.activeForm ?: current.content}",
                    fontSize = textSize, color = colors.muted, maxLines = 1, overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
            } else {
                Spacer(Modifier.weight(1f))
            }
            Icon(
                if (open) Icons.Outlined.KeyboardArrowDown else Icons.Outlined.KeyboardArrowUp,
                contentDescription = null, tint = colors.muted, modifier = Modifier.size(16.dp),
            )
        }

        // 접기·펴기는 아이폰과 같은 0.18초
        AnimatedVisibility(
            visible = open,
            enter = expandVertically(tween(180)) + fadeIn(tween(180)),
            exit = shrinkVertically(tween(180)) + fadeOut(tween(180)),
        ) {
            Column(Modifier.padding(top = 8.dp, start = 2.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                todos.forEach { t -> TodoRow(t, textSize) }
            }
        }
    }
}

@Composable
private fun TodoRow(t: TodoItem, textSize: TextUnit) {
    val completed = t.status == "completed"
    val inProgress = t.status == "in_progress"
    val iconColor = if (t.status == "pending") colors.muted else colors.accent
    Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        // 아이콘을 글 첫 줄 가운데에 맞춘다
        Box(Modifier.padding(top = 2.dp).size(16.dp), contentAlignment = Alignment.Center) {
            when {
                completed -> Icon(Icons.Filled.CheckCircle, contentDescription = null, tint = iconColor, modifier = Modifier.size(16.dp))
                inProgress -> DashedCircle(iconColor)
                else -> Icon(Icons.Outlined.RadioButtonUnchecked, contentDescription = null, tint = iconColor, modifier = Modifier.size(16.dp))
            }
        }
        Text(
            t.content,
            fontSize = textSize,
            fontWeight = if (inProgress) FontWeight.SemiBold else FontWeight.Normal,
            color = if (completed) colors.muted else colors.text,
            textDecoration = if (completed) TextDecoration.LineThrough else null,
            modifier = Modifier.weight(1f),
        )
    }
}

/** 하고 있는 일 표시(아이폰의 점선 원). 머티리얼 아이콘에 없어 직접 그린다 */
@Composable
private fun DashedCircle(color: Color) {
    Canvas(Modifier.size(13.dp)) {
        val w = 1.5.dp.toPx()
        val r = (size.minDimension - w) / 2
        val dash = (2 * Math.PI * r / 16).toFloat()
        drawCircle(
            color = color,
            radius = r,
            style = Stroke(width = w, pathEffect = PathEffect.dashPathEffect(floatArrayOf(dash, dash))),
        )
    }
}
