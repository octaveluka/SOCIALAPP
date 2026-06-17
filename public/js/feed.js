// === LIKE (AJAX) ===
document.addEventListener("click", async (e) => {
    const btn = e.target.closest(".like-btn")
    if (!btn) return

    const postId = btn.getAttribute("data-id")

    try {
        const res = await fetch(`/post/${postId}/like`, { method: "POST" })
        const data = await res.json()

        if (data.success) {
            btn.querySelector(".likes-count").innerText = data.likesCount
            if (data.liked) {
                btn.classList.add("liked")
            } else {
                btn.classList.remove("liked")
            }
        }
    } catch (err) {
        console.error("Erreur like :", err)
    }
})

// === COMMENTAIRE (AJAX) ===
document.addEventListener("submit", async (e) => {
    const form = e.target.closest(".ajax-comment-form")
    if (!form) return

    e.preventDefault()

    const postId = form.getAttribute("data-id")
    const input = form.querySelector("input[name='texte']")
    const texte = input.value.trim()
    if (!texte) return

    try {
        const res = await fetch(`/post/${postId}/comment`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ texte })
        })

        const data = await res.json()
        if (!data.success) return

        const commentsList = form.parentElement.querySelector(".comments-list")
        const commentEl = document.createElement("div")
        commentEl.className = "comment"
        commentEl.innerHTML = `
            <img src="${data.comment.auteur.photoProfil}" class="comment-avatar" alt="">
            <div class="comment-bubble">
                <div class="comment-author">${escapeHtml(data.comment.auteur.nom)}</div>
                <div>${escapeHtml(data.comment.texte)}</div>
            </div>
        `
        commentsList.appendChild(commentEl)

        const card = form.closest(".post")
        card.querySelector(".comments-count").innerText = data.commentsCount

        input.value = ""
    } catch (err) {
        console.error("Erreur commentaire :", err)
    }
})

function escapeHtml(text) {
    const div = document.createElement("div")
    div.innerText = text
    return div.innerHTML
}
