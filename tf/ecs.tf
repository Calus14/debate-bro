resource "aws_ecr_repository" "bot_repo" {
  name = "discord-echo-bot"
}

resource "aws_ecs_cluster" "bot_cluster" {
  name = "discord-echo-bot"
}

resource "aws_cloudwatch_log_group" "bot_logs" {
  name              = "/ecs/discord-echo-bot"
  retention_in_days = 14
}

resource "aws_ecs_task_definition" "bot_task" {
  family                   = "discord-echo-bot"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.ecs_task_execution_role.arn
  container_definitions = jsonencode([{
    name         = "discord-echo-bot"
    image        = "${aws_ecr_repository.bot_repo.repository_url}:latest"
    essential    = true
    portMappings = [{ containerPort = 3000, hostPort = 3000, protocol = "tcp" }]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.bot_logs.name
        awslogs-region        = var.aws_region
        awslogs-stream-prefix = "ecs"
      }
    }
    environment = [
      {
        name  = "S3_BUCKET_NAME"
        value = var.bucket_name
      },
      {
        name  = "AWS_REGION"
        value = var.aws_region
      }
    ]
      secrets = [{
        name      = "DISCORD_TOKEN"
        valueFrom = aws_ssm_parameter.discord_token.arn
      }]
  }])
}

resource "aws_ecs_service" "ecs_service" {
  name            = "discord-echo-bot"
  cluster         = aws_ecs_cluster.bot_cluster.id
  task_definition = aws_ecs_task_definition.bot_task.arn
  desired_count   = 1
  launch_type     = "FARGATE"
  network_configuration {
    subnets          = data.aws_subnets.default.ids
    security_groups  = [aws_security_group.bot_sg.id]
    assign_public_ip = true
  }

  depends_on = [aws_cloudwatch_log_group.bot_logs]
}

resource "aws_ssm_parameter" "discord_token" {
  name  = "/debate-bro/discord_token"
  type  = "SecureString"
  value = var.discord_token
}