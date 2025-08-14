data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
}

resource "aws_security_group" "bot_sg" {
  name        = "${var.app_name}-sg"
  description = "Egress-only SG for ECS tasks"
  vpc_id      = data.aws_vpc.default.id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${var.app_name}-sg" }
}

output "subnet_ids" { value = data.aws_subnets.default.ids }
output "bot_sg_id" { value = aws_security_group.bot_sg.id }